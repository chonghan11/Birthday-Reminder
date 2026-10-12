// Settings come from environment variables so the same code runs locally and in AWS.
const sendFromHour = process.env.SEND_FROM_HOUR === undefined ? 8 : Number(process.env.SEND_FROM_HOUR);

module.exports = {
  port: Number(process.env.PORT) || 3000,
  storage: process.env.STORAGE_BACKEND || 'memory',
  mailer: process.env.MAILER_BACKEND || 'console',
  catalog: process.env.CATALOG_BACKEND || 'curated',
  // How often the local server checks for due reminders (simulates the cloud scheduler).
  localSchedulerSeconds: Number(process.env.LOCAL_SCHEDULER_SECONDS) || 30,
  sendFromHour: Number.isInteger(sendFromHour) && sendFromHour >= 0 && sendFromHour <= 23 ? sendFromHour : 8,
  awsRegion: process.env.AWS_REGION || 'ap-southeast-1',
  TableName: process.env.TABLE_NAME || '',
};
