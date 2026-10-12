// Local "mailer": prints the email instead of sending it.
//
// This is the mailer "port": any backend (SES, ...) must offer
// `send({ to, subject, text })`, return when the email was accepted, and throw on failure.
function createConsoleMailer() {
  return {
    async send({ to, subject, text }) {
      console.log(`\n--- EMAIL to ${to} ---\nSubject: ${subject}\n\n${text}\n---------------------\n`);
    },
  };
}

module.exports = createConsoleMailer;
