module.exports = {
  apps: [{
    name: 'pompeyo-ws',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: '/var/log/pompeyo-ws-error.log',
    out_file: '/var/log/pompeyo-ws-out.log',
    log_file: '/var/log/pompeyo-ws.log',
    time: true
  }]
};
