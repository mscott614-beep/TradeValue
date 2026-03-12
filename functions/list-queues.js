const { CloudTasksClient } = require('@google-cloud/tasks');

async function listQueues() {
  const client = new CloudTasksClient();
  const parent = 'projects/puckvaluebak-38609945-5e85c/locations/us-central1';
  try {
    const [queues] = await client.listQueues({ parent });
    console.log('Queues:');
    queues.forEach(q => console.log(q.name));
  } catch (error) {
    console.error('Error listing queues:', error);
  }
}

listQueues();
