// WeakMap dùng chung: page -> chat tracker (xem lib/chat-observer.js).
const chatTextReaders = new WeakMap();

module.exports = { chatTextReaders };
