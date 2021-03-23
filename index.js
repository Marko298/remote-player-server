const express = require("express");
const app = express();
const cors = require("cors");
const path = require("path");
const server = require("http").createServer(app);
const socketServer = require("socket.io");
const {
  uniqueNamesGenerator,
  animals,
  colors,
} = require("unique-names-generator");

const io = socketServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const port = +process.env.PORT || 4000;
server.listen(port, "0.0.0.0", () => {
  console.log("Server listening at port %d", port);
});

// Routing
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

function generateDeviceName() {
  // return randomEmoji();
  return uniqueNamesGenerator({
    dictionaries: [colors, animals],
    separator: " ",
    style: "capital",
  });
}

let sockets = {};
let devices = [];
let master = null;
let state = null;

const findDevice = (deviceUuid) =>
  devices.find((device) => device.id === deviceUuid);

const devicesWithout = (deviceUuid) =>
  devices.filter((device) => device.id !== deviceUuid);

io.on("connection", (socket) => {
  let deviceUuid;

  socket.on("switchMaster", (newMasterId) => {
    if (!sockets[newMasterId]) {
      return console.error("Failed to find device: " + newMasterId);
    }

    if (master && !findDevice(newMasterId).ready) {
      return console.error(`Device not ready. Can't switch to: ${newMasterId}`);
    }

    sockets[newMasterId].emit("nominatedAsMaster", state);
  });

  socket.on("confirmMasterSwitch", (masterState) => {
    master = deviceUuid;
    state = masterState;

    socket.broadcast.emit("masterChanged", master, state);
  });

  socket.on("stateChanged", (newState) => {
    if (deviceUuid !== master) return;

    state = newState;
    socket.broadcast.emit("stateChanged", newState);
  });

  socket.on("command", (command, payload) => {
    if (!master) return;

    console.log("Sending command: " + command + " with payload: " + payload);

    sockets[master].emit("command", command, payload);
  });

  socket.on("announce", (uuid) => {
    if (sockets[uuid]) {
      return console.error("Duplicated device: " + uuid);
    }

    console.log("Device announced: " + uuid);

    deviceUuid = uuid;
    sockets[uuid] = socket;
    devices.push({
      id: deviceUuid,
      name: generateDeviceName(),
      ready: false,
    });

    socket.emit("registered", devices, master, state);

    io.emit("deviceListChanged", devices);
  });

  socket.on("ready", () => {
    console.log("Device is ready: " + deviceUuid);
    findDevice(deviceUuid).ready = true;
    io.emit("deviceListChanged", devices);
  });

  socket.on("disconnect", () => {
    if (!deviceUuid) return;

    console.log("Device disconnected: " + deviceUuid);

    delete socket[deviceUuid];
    devices = devicesWithout(deviceUuid);

    if (master === deviceUuid) {
      console.log("Master disconnected. Clearing state");

      state = null;
      master = null;

      io.emit("masterChanged", master, state);
    }

    io.emit("deviceListChanged", devices);
  });
});
