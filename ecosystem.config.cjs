module.exports = {
  apps: [
    {
      name: 'o11ytips',
      script: 'dist/index.js',
      cwd: '/root/o11y.tips',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3005,
      },
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      log_file: 'logs/combined.log',
      time: true,
    },
  ],
};
