module.exports = {
  apps: [
    {
      name: "knil-bot",
      script: "./bot.js",
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "knil-mqtt-bridge",
      script: "./mqtt-bridge.js",
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
