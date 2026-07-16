/**
 * Accept the one, explicit shutdown request used by a future desktop shell.
 *
 * The server remains a normal Node process under `npm start`.  When it is
 * hosted by Electron's utilityProcess, `process.parentPort` receives messages;
 * when it is hosted by child_process.fork(), Node emits `process` messages.
 * Keeping this adapter free of Electron imports makes both paths testable and
 * keeps the portable runtime independent from Electron.
 */
const SHUTDOWN_MESSAGE = 'elitesand:shutdown';

function isShutdownMessage(message) {
  if (message === SHUTDOWN_MESSAGE) return true;
  return !!message
    && typeof message === 'object'
    && message.type === SHUTDOWN_MESSAGE;
}

function attachParentShutdown({
  processObject = process,
  parentPort = processObject.parentPort,
  onShutdown,
  onError = () => {},
} = {}) {
  if (typeof onShutdown !== 'function') {
    throw new TypeError('attachParentShutdown requires an onShutdown callback');
  }

  let handled = false;
  const invoke = (message) => {
    if (handled || !isShutdownMessage(message)) return false;
    handled = true;
    try {
      Promise.resolve(onShutdown()).catch(onError);
    } catch (err) {
      onError(err);
    }
    return true;
  };
  const onParentPortMessage = (event) => invoke(event?.data);
  const onProcessMessage = (message) => invoke(message);

  if (parentPort && typeof parentPort.on === 'function') {
    parentPort.on('message', onParentPortMessage);
  }
  if (processObject && typeof processObject.on === 'function') {
    processObject.on('message', onProcessMessage);
  }

  return () => {
    if (parentPort && typeof parentPort.removeListener === 'function') {
      parentPort.removeListener('message', onParentPortMessage);
    }
    if (processObject && typeof processObject.removeListener === 'function') {
      processObject.removeListener('message', onProcessMessage);
    }
  };
}

module.exports = { SHUTDOWN_MESSAGE, isShutdownMessage, attachParentShutdown };
