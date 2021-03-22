const express = require("express");
const cors = require("cors");
const app = express();
const path = require("path");
const server = require("http").createServer(app);
const port = process.env.PORT || 4000;
const emoji = require("./emoji");

const io = require("socket.io")(server, {
  cors: {
    origin: "http://192.168.1.169:8080",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

server.listen(port, "0.0.0.0", () => {
  console.log("Server listening at port %d", port);
});

// Routing
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

function random(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min);
}

const randomEmoji = () => emoji[random(0, emoji.length - 1)];

let deviceNumber = 0;
let sockets = {};
let devices = [];
let master = null;
let state = null;

io.on("connection", (socket) => {
  let deviceUuid;

  socket.on("switchMaster", (newMasterId) => {
    const newMaster = devices.find(({ id }) => id === newMasterId);

    if (!newMaster) {
      console.error("Failed to find device: " + newMasterId);
      return;
    }

    master = newMasterId;

    console.log("Switching to master: " + newMasterId);

    const masterSocket = sockets[newMasterId];

    masterSocket.broadcast.emit("masterChanged", { master, state });
    masterSocket.emit("nominatedAsMaster", state);
  });

  socket.on("fetchState", () => {
    socket.emit("stateChanged", state);
  });

  socket.on("fetchDevices", () => {
    socket.emit("deviceListChanged", devices);
  });

  socket.on("fetchMaster", () => {
    socket.emit("masterChanged", { master, state });
  });

  socket.on("checkIfMaster", () => {
    if (deviceUuid !== master) {
      return;
    }

    socket.emit("nominatedAsMaster", state);
  });

  socket.on("stateChanged", (newState) => {
    // console.log("Received state from: " + deviceUuid);

    if (deviceUuid !== master) return;

    // console.log("Updating state from: " + deviceUuid);
    state = newState;
    socket.broadcast.emit("stateChanged", newState);
  });

  socket.on("command", ({ command, payload }) => {
    if (!master) {
      return;
    }

    console.log(
      "Sending command: " +
        command +
        " with payload: " +
        JSON.stringify(payload)
    );

    sockets[master].emit("command", { command, payload });
  });

  socket.on("announce", (uuid) => {
    console.log("Device announced: " + uuid);

    deviceUuid = uuid;

    if (devices.find(({ id }) => id === uuid)) {
      console.error("Duplicated device: " + uuid);
      return;
    }

    sockets[uuid] = socket;

    socket.emit("registered", {
      master,
      devices,
      state,
    });

    devices.push({
      id: deviceUuid,
      name: "Device " + randomEmoji(),
    });

    io.emit("deviceListChanged", devices);

    if (!master) {
      console.log("No master device found. Setting new master: " + deviceUuid);
      master = deviceUuid;
    }

    socket.emit("nominatedAsMaster", false);
  });

  // socket.on("ready", () => {
  //   devices.push({
  //     id: deviceUuid,
  //     name: randomEmoji(),
  //   });
  //
  //   io.emit("deviceListChanged", devices);
  //
  //   if (!master) {
  //     console.log("No master device found. Setting new master: " + deviceUuid);
  //     master = deviceUuid;
  //   }
  // });

  socket.on("disconnect", () => {
    if (!deviceUuid) return;

    console.log("Device disconnected: " + deviceUuid);

    delete socket[deviceUuid];

    devices = devices.filter(({ id }) => id !== deviceUuid);

    if (master === deviceUuid) {
      const newMaster = devices.find(Boolean);

      state = null;

      if (!newMaster) {
        console.log("No devices left. Master is empty");
        master = null;
        return;
      }

      master = newMaster.id;

      console.log("Setting new master: " + master);

      const masterSocket = sockets[master];

      masterSocket.broadcast.emit("masterChanged", { master, state });
      masterSocket.emit("nominatedAsMaster", false);
    }

    io.emit("deviceListChanged", devices);
  });
});
