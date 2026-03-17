module.exports = {
    apps: [
      {
        name: "expo-updates-server",
        script: "npm",
        args: "start",
        watch: false,
        env: {
          PORT: 3427
        }
      }
    ]
  }
  