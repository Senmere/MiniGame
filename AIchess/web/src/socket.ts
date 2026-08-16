import { io, type Socket } from 'socket.io-client';

export const socket: Socket = io({ autoConnect: false, transports: ['websocket', 'polling'] });

export function connectSocket() {
  if (!socket.connected) socket.connect();
  return socket;
}
