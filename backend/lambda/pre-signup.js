// Runs just before Cognito creates a new account (a "pre sign-up" trigger). Throwing refuses the
// sign-up, and Cognito passes the message back to the page. It guards the sign-up form against bots:
//   1. throwaway email domains are refused
//   2. only so many sign-up attempts are accepted per hour in total, so a bot cannot use the form
//      to flood strangers with verification emails or use up Cognito's daily email allowance
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const config = require('../src/config');
const { isDisposableEmail } = require('../src/disposable-email');

const MAX_PER_HOUR = Number(process.env.MAX_SIGNUPS_PER_HOUR) || 20;
const HOUR_MS = 60 * 60 * 1000;

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.awsRegion }));

// One counter item in the table. It has no email or monthDay, so it never shows up in the app's indexes.
const KEY = { id: 'signup-limit' };

// Counts this attempt and returns how many there have been in the current hour.
async function countAttempt(now = Date.now()) {
  try {
    // Nothing counted yet, or the last window is over: start a new hour at 1.
    await db.send(new UpdateCommand({
      TableName: config.TableName,
      Key: KEY,
      UpdateExpression: 'SET windowStart = :now, attempts = :one',
      ConditionExpression: 'attribute_not_exists(windowStart) OR windowStart < :oldest',
      ExpressionAttributeValues: { ':now': now, ':one': 1, ':oldest': now - HOUR_MS },
    }));
    return 1;
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
  // Still inside the current hour: add one. ADD is atomic, so two sign-ups at once are both counted.
  const { Attributes } = await db.send(new UpdateCommand({
    TableName: config.TableName,
    Key: KEY,
    UpdateExpression: 'ADD attempts :one',
    ExpressionAttributeValues: { ':one': 1 },
    ReturnValues: 'UPDATED_NEW',
  }));
  return Attributes.attempts;
}

exports.handler = async (event) => {
  const email = String(event.request.userAttributes.email || '').trim().toLowerCase();
  if (isDisposableEmail(email)) {
    throw new Error('Please use a permanent email address, not a disposable one.');
  }
  if ((await countAttempt()) > MAX_PER_HOUR) {
    throw new Error('Sign-ups are very busy right now. Please try again in an hour.');
  }
  return event;
};

exports.countAttempt = countAttempt;
