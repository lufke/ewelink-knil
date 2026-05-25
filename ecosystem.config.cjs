module.exports = {
  apps: [
    {
      name: "knil-mqtt-bridge",
      script: "./src/mqtt-bridge.js",
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
