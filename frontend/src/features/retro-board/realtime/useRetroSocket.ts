/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { retroKeys } from '../../../shared/queryKeys';
import type { RetroBoardDetail, RetroParticipant } from '../types';

/**
 * Retro board realtime.
 *
 * Events patch the query cache directly rather than triggering a refetch — a
 * ten-person retro produces a lot of traffic, and refetching the whole board on
 * every keystroke-scale event would be pathological.
 *
 * If the socket never connects, or drops, nothing here runs and the board's
 * query falls back to 5s polling (see useRetroBoard). All writes are REST
 * regardless, so the degraded path is the same code path, just slower.
 */

let socketRef: Socket | null = null;

function getSocket(): Socket {
  if (socketRef?.connected || socketRef?.active) return socketRef;
  socketRef = io('/retro', {
    path: '/api/socket.io',
    transports: ['websocket'],
    auth: { token: localStorage.getItem('token') },
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  return socketRef;
}

export function useRetroSocket(boardId: number | undefined | null) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<RetroParticipant[]>([]);
  const boardIdRef = useRef(boardId);
  boardIdRef.current = boardId;

  useEffect(() => {
    if (!boardId) return;

    const socket = getSocket();
    const key = retroKeys.board(boardId);

    const patch = (fn: (d: RetroBoardDetail) => RetroBoardDetail) => {
      qc.setQueryData<RetroBoardDetail>(key, prev => (prev ? fn(prev) : prev));
    };

    const join = () => {
      socket.emit('retro:join', { boardId }, (res: any) => {
        if (res?.error) {
          // Access was refused (or the board vanished). Leave polling to
          // surface the real error rather than guessing at one here.
          setConnected(false);
          return;
        }
        setConnected(true);
      });
    };

    const onConnect = () => join();
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => setConnected(false);

    // A reconnect may have missed deltas, so resync once rather than trying to
    // replay them.
    const onReconnect = () => {
      qc.invalidateQueries({ queryKey: key });
      join();
    };

    const onItemCreated = ({ item }: any) =>
      patch(d => (d.items.some(i => i.id === item.id) ? d : { ...d, items: [...d.items, item] }));

    const onItemUpdated = ({ item }: any) =>
      patch(d => ({ ...d, items: d.items.map(i => (i.id === item.id ? { ...i, ...item } : i)) }));

    const onItemDeleted = ({ itemId }: any) =>
      patch(d => ({ ...d, items: d.items.filter(i => i.id !== itemId) }));

    const onVoteChanged = ({ itemId, voteCount }: any) =>
      patch(d => ({ ...d, items: d.items.map(i => (i.id === itemId ? { ...i, voteCount } : i)) }));

    // The full pick set is broadcast rather than a delta: a rank swap is two
    // changes, and applying them in the wrong order would briefly show two
    // items sharing a rank.
    const onTopPicksChanged = ({ picks }: any) =>
      patch(d => {
        const byId = new Map<number, number>(picks.map((p: any) => [p.itemId, p.rank]));
        return { ...d, items: d.items.map(i => ({ ...i, topPickRank: byId.get(i.id) ?? null })) };
      });

    const onCommentCountChanged = ({ itemId, commentCount }: any) => {
      patch(d => ({ ...d, items: d.items.map(i => (i.id === itemId ? { ...i, commentCount } : i)) }));
      qc.invalidateQueries({ queryKey: retroKeys.comments(itemId) });
    };

    const onBoardUpdated = ({ board }: any) => patch(d => ({ ...d, board: { ...d.board, ...board } }));

    const onItemConverted = ({ item }: any) =>
      patch(d => ({ ...d, items: d.items.map(i => (i.id === item.id ? { ...i, ...item } : i)) }));

    const onPresence = ({ boardId: bid, participants: p }: any) => {
      if (bid === boardIdRef.current) setParticipants(p);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.io.on('reconnect', onReconnect);
    socket.on('retro:item_created', onItemCreated);
    socket.on('retro:item_updated', onItemUpdated);
    socket.on('retro:item_moved', onItemUpdated);
    socket.on('retro:item_deleted', onItemDeleted);
    socket.on('retro:vote_changed', onVoteChanged);
    socket.on('retro:top_picks_changed', onTopPicksChanged);
    socket.on('retro:comment_created', onCommentCountChanged);
    socket.on('retro:comment_deleted', onCommentCountChanged);
    socket.on('retro:comment_updated', ({ itemId }: any) =>
      qc.invalidateQueries({ queryKey: retroKeys.comments(itemId) }));
    socket.on('retro:board_updated', onBoardUpdated);
    socket.on('retro:item_converted', onItemConverted);
    socket.on('retro:presence', onPresence);

    if (socket.connected) join();

    const ping = setInterval(() => {
      if (socket.connected) socket.emit('retro:presence_ping', { boardId });
    }, 30_000);

    return () => {
      clearInterval(ping);
      socket.emit('retro:leave', { boardId });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect', onReconnect);
      socket.off('retro:item_created', onItemCreated);
      socket.off('retro:item_updated', onItemUpdated);
      socket.off('retro:item_moved', onItemUpdated);
      socket.off('retro:item_deleted', onItemDeleted);
      socket.off('retro:vote_changed', onVoteChanged);
      socket.off('retro:top_picks_changed', onTopPicksChanged);
      socket.off('retro:comment_created', onCommentCountChanged);
      socket.off('retro:comment_deleted', onCommentCountChanged);
      socket.off('retro:comment_updated');
      socket.off('retro:board_updated', onBoardUpdated);
      socket.off('retro:item_converted', onItemConverted);
      socket.off('retro:presence', onPresence);
      setConnected(false);
    };
  }, [boardId, qc]);

  return { connected, participants };
}

/** Tear the shared socket down on logout so a new user never inherits it. */
export function disconnectRetroSocket() {
  socketRef?.disconnect();
  socketRef = null;
}
