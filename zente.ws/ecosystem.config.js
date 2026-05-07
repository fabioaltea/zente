module.exports = {
  apps: [{
    name: 'signaling-server',
    script: 'src/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
