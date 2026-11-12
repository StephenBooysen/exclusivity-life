'use strict';

/**
 * @fileoverview socket.io server.
 *
 * Not a second authorisation domain. The handshake reuses the Express session,
 * and every inbound event re-runs the same service-layer checks the REST path
 * runs — the socket handler is a transport, not an alternative rule set.
 *
 * REST stays the source of truth for message sends: the client posts and
 * treats the socket echo as delivery confirmation, so a dropped socket
 * degrades to polling rather than to lost messages.
 */

const { Server } = require('socket.io');

function createRealtime({ sessionMiddleware, members, matching, messaging, profiles, logger }) {
  /** @type {import('socket.io').Server|null} */
  let io = null;

  function attach(httpServer) {
    io = new Server(httpServer, {
      path: '/rt',
      serveClient: false,
      cors: { origin: false }
    });

    // Run the Express session middleware over the handshake request so the
    // socket sees exactly the session the HTTP API sees.
    io.engine.use(sessionMiddleware);

    io.use(async (socket, next) => {
      try {
        const memberId = socket.request.session?.memberId;
        if (!memberId) return next(new Error('unauthorised'));
        const member = await members.get(memberId);
        if (!member || !members.isActive(member)) return next(new Error('unauthorised'));
        socket.data.memberId = member.id;
        return next();
      } catch (err) {
        return next(new Error('unauthorised'));
      }
    });

    io.on('connection', (socket) => {
      const memberId = socket.data.memberId;
      socket.join(`member:${memberId}`);

      socket.on('match:join', async (matchId, ack) => {
        try {
          await matching.assertParticipant(memberId, matchId);
          socket.join(`match:${matchId}`);
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: err.code || 'forbidden' });
        }
      });

      socket.on('match:leave', (matchId) => {
        socket.leave(`match:${matchId}`);
      });

      socket.on('typing', async ({ matchId, typing }) => {
        try {
          const match = await matching.assertParticipant(memberId, matchId);
          const prefs = await profiles.getPreferences(memberId);
          if (prefs.privacy?.showOnlineStatus === false) return;
          const otherId = match.memberIds.find((id) => id !== memberId);
          io.to(`member:${otherId}`).emit('typing', { matchId, memberId, typing: Boolean(typing) });
        } catch {
          // A typing event on a closed match is not worth an error round trip.
        }
      });

      socket.on('message:read', async ({ matchId }) => {
        try {
          const member = await members.get(memberId);
          await messaging.markRead(member, matchId);
        } catch (err) {
          logger.debug?.(`[rt] read failed: ${err.message}`);
        }
      });

      socket.on('disconnect', () => {
        socket.leave(`member:${memberId}`);
      });
    });

    logger.info('[rt] realtime attached at /rt');
    return io;
  }

  function toMember(memberId, event, payload) {
    io?.to(`member:${memberId}`).emit(event, payload);
  }

  function toMatch(matchId, event, payload) {
    io?.to(`match:${matchId}`).emit(event, payload);
  }

  /**
   * Drops a member's live sockets — used on suspension and ban so an existing
   * connection does not outlive the enforcement action.
   */
  async function disconnectMember(memberId) {
    if (!io) return;
    const sockets = await io.in(`member:${memberId}`).fetchSockets();
    for (const socket of sockets) socket.disconnect(true);
  }

  function connectionCount() {
    return io?.engine?.clientsCount || 0;
  }

  return { attach, toMember, toMatch, disconnectMember, connectionCount };
}

module.exports = { createRealtime };
