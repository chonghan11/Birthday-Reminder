const { DynamoDBClient, DynamoDB } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
}= require ( "@aws-sdk/lib-dynamodb");
const config = require("../config");

function createdb()
{
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({region: config.awsRegion}));
    const TableName = config.TableName;

    return{
        async put(item){
            await client.send(new PutCommand({ TableName, Item: item} ));
        },

        async get(id) {
      const { Item } = await client.send(new GetCommand({ TableName, Key: { id } }));
      return Item || null;
        },

     async listByEmail(email) {
      const { Items } = await client.send(
        new QueryCommand({
          TableName,
          IndexName: 'email-index',
          KeyConditionExpression: 'email = :email',
          ExpressionAttributeValues: { ':email': email },
        })
      );
      return Items || [];
    },
    async listByMonthDay(monthDay) {
      // Query the monthDay-index for just that day, one 1 MB page at a time.
      const items = [];
      let ExclusiveStartKey;
      do {
        const page = await client.send(
          new QueryCommand({
            TableName,
            IndexName: 'monthDay-index',
            KeyConditionExpression: 'monthDay = :monthDay',
            ExpressionAttributeValues: { ':monthDay': monthDay },
            ExclusiveStartKey,
          })
        );
        items.push(...(page.Items || []));
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items;
    },

    async delete(id) {
      const { Attributes } = await client.send(
        new DeleteCommand({ TableName, Key: { id }, ReturnValues: 'ALL_OLD' })
      );
      return Boolean(Attributes); // true only if something existed
    },

    async markSent(id, key) {
      try {
        await client.send(
          new UpdateCommand({
            TableName,
            Key: { id },
            UpdateExpression: 'SET sent = list_append(if_not_exists(sent, :empty), :key)',
            // Only add the key if it is not there yet, and only if the item exists.
            ConditionExpression: 'attribute_exists(id) AND NOT contains(sent, :keyValue)',
            ExpressionAttributeValues: { ':empty': [], ':key': [key], ':keyValue': key },
          })
        );
      } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') throw err;
          }
    },
    };
}
module.exports = createdb;