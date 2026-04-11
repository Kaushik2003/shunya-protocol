import { startVerifyProofWorker }     from './verifyProof';
import { startCopyAttestationWorker } from './copyAttestation';
import { startDeliverWebhookWorker }  from './deliverWebhook';

export function startAllWorkers() {
  const workers = [
    startVerifyProofWorker(),
    startCopyAttestationWorker(),
    startDeliverWebhookWorker(),
  ];

  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      console.error(`[worker:${worker.name}] job ${job?.id} failed:`, err.message);
    });
    worker.on('completed', (job) => {
      console.log(`[worker:${worker.name}] job ${job.id} completed`);
    });
  }

  console.log('Workers started: verify-proof, copy-attestation, deliver-webhook');
  return workers;
}
