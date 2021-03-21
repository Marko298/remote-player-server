const express = require("express");
const cors = require("cors");
const app = express();
const path = require("path");
const server = require("http").createServer(app);
const port = process.env.PORT || 4000;

const io = require("socket.io")(server, {
  cors: {
    origin: "http://localhost:8080",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

server.listen(port, () => {
  console.log("Server listening at port %d", port);
});

// Routing
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

let sockets = {};
let devices = [];
let master = null;
let state = null;

function forward(socket, event) {
  socket.on(event, (data) => {
    console.log("Event: " + event + " data: " + JSON.stringify(data));

    return socket.broadcast.emit(event, data);
  });
}

io.on("connection", (socket) => {
  socket.on("switchMaster", (uuid) => {
    const newMaster = devices.find(({ id }) => id === uuid);

    if (!newMaster) {
      console.error("Failed to find device: " + uuid);
    } else {
      console.log("Switching to master: " + uuid);
    }

    io.emit("masterChanged", newMaster);
  });

  socket.on("fetchState", () => {
    socket.emit("stateChanged", state);
  });

  socket.on("fetchDevices", () => {
    socket.emit("deviceListChanged", devices);
  });

  socket.on("fetchMaster", () => {
    socket.emit(
      "masterChanged",
      devices.find(({ id }) => id === master)
    );
  });

  socket.on("stateChanged", (newState) => {
    if (socket.id === master) {
      state = newState;
      socket.broadcast.emit("stateChanged", newState);
    }
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

    socket.id = uuid;

    if (devices.find(({ id }) => id === uuid)) {
      console.error("Duplicated device: " + uuid);
      return;
    }

    if (!master) {
      console.log("No master device found. Setting new master: " + uuid);
      master = uuid;
    }

    sockets[uuid] = socket;

    devices.push({
      id: uuid,
      name: "Device #" + devices.length,
    });

    socket.emit("registered", {
      master,
      devices,
      state,
    });

    socket.broadcast.emit("deviceListChanged", devices);

    io.emit("masterChanged", master);
  });

  socket.on("disconnect", () => {
    console.log("Socket closed: " + socket.id);

    delete socket[socket.id];

    devices = devices.filter(({ id }) => id !== socket.id);

    if (master === socket.id) {
      const newDevice = devices.find(Boolean);
      master = newDevice?.id;

      io.emit("masterChanged", master);
    }

    io.emit("deviceListChanged", devices);
  });
});
