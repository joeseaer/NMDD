import { executeXMindWorkerRequest } from './xmindWorkerRuntime';
import type { XMindWorkerRequest } from './xmindWorkerProtocol';

interface XMindDedicatedWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<XMindWorkerRequest>) => void,
  ): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const workerScope = globalThis as unknown as XMindDedicatedWorkerScope;

workerScope.addEventListener('message', (event) => {
  const response = executeXMindWorkerRequest(event.data);
  const transfer: Transferable[] = [];
  if (
    response.ok
    && response.operation === 'export'
    && response.result.bytes
  ) {
    transfer.push(response.result.bytes.buffer);
  }
  workerScope.postMessage(response, transfer);
});

export {};
