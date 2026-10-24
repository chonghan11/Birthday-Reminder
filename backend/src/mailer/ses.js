// Real mailer: sends the email through Amazon SES.
// Same "port" as console.js: `send({ to, subject, text })` returns once SES has accepted the email
// and throws if it was refused (the hourly job then keeps the reminder pending and retries next run).
// Needs SENDER_EMAIL (an address verified in SES). While the account is in the SES sandbox, the
// recipient must be a verified address too, otherwise SES refuses with MessageRejected.
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const config = require('../config');

function createSesMailer() {
  if (!config.senderEmail) {
    throw new Error('SENDER_EMAIL is not set. It must be an address verified in SES.');
  }
  const client = new SESv2Client({ region: config.awsRegion });

  return {
    async send({ to, subject, text }) {
      await client.send(new SendEmailCommand({
        FromEmailAddress: `Birthday Buddy <${config.senderEmail}>`,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Text: { Data: text, Charset: 'UTF-8' } },
          },
        },
      }));
    },
  };
}

module.exports = createSesMailer;
