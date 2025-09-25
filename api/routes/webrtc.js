const { generateRoomId } = require('../utils/availability');
const sessionManager = require('../utils/webrtc-session-management');
const { pool } = require('../config/database');
const { timeCheck } = require('../utils/availability');
const { validateAuthToken } = require('../middleware/auth');

const BASE_URL = process.env.BASE_URL || 'https://plebemr.com';

// In-memory storage for signaling (use Redis in production)
const sseConnections = new Map(); // roomId -> Set of SSE response objects

export function setupWebRTCRoutes(app) {

  // Endpoint to create a new appointment/room
  app.post('/api/appointments/create', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const { doctorName, appointmentTime, notes } = req.body;
    const roomId = generateRoomId();
    
    // Store appointment in your system (database, memory, etc.)
    // For now, just return the room ID
    return res.json({
      roomId,
      doctorName,
      appointmentTime,
      webrtcUrl: `${BASE_URL}/api/webrtc/rooms/${roomId}`,
      message: `Appointment room created: ${roomId}`
    });
  });

  app.get('/api/patients/appointments', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const { pubkey } = req.user; // Only pubkey is guaranteed to be in JWT
    
    let connection;

    console.log(`=== GET PATIENT APPOINTMENTS ===`);
    console.log(`User pubkey: ${pubkey}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      connection = await pool.getConnection();

      // First, get the user ID from the pubkey
      const [userRows] = await connection.execute(`
        SELECT id FROM users WHERE nostr_pubkey = ?
      `, [pubkey]);

      if (userRows.length === 0) {
        connection.release();
        return res.status(403).json({
          success: false,
          error: 'User not found for this pubkey'
        });
      }

      const userId = userRows[0].id;

      // Now get appointments for this user ID
      const [rows] = await connection.execute(`
        SELECT 
          a.id,
          a.start_datetime,
          a.end_datetime,
          a.location,
          a.notes,
          a.status,
          a.create_datetime,
          doctor.first_name as doctor_first_name,
          doctor.last_name as doctor_last_name,
          doctor.email as doctor_email,
          doctor.timezone as doctor_timezone,
          s.name as service_name,
          s.duration as service_duration
        FROM appointments a 
        JOIN users doctor ON doctor.id = a.id_users_provider
        LEFT JOIN services s ON s.id = a.id_services
        WHERE a.id_users_customer = ?
        ORDER BY a.start_datetime ASC
      `, [userId]);

      // Format the response...
      const appointments = rows.map(appointment => ({
        id: appointment.id,
        datetime: appointment.start_datetime,
        location: appointment.location,
        notes: appointment.notes,
        status: appointment.status,
        createdAt: appointment.created_at,
        doctor: {
          firstName: appointment.doctor_first_name,
          lastName: appointment.doctor_last_name,
          email: appointment.doctor_email,
          timezone: appointment.doctor_timezone
        },
        service: appointment.service_name ? {
          name: appointment.service_name,
          duration: appointment.service_duration
        } : null,
        isVideoAppointment: appointment.location === 'bright-dolphin-swimming',
        videoRoomUrl: appointment.location === 'bright-dolphin-swimming' 
          ? `${process.env.BASE_URL}/video-call?room=${appointment.location}`
          : null
      }));

      console.log(`Found ${rows.length} appointments for patient ${userId} (pubkey: ${pubkey}), appt start: ${appointments}`);

      connection.release();

      return res.json({
        success: true,
        appointments: appointments,
        count: appointments.length
      });

    } catch (error) {
      if (connection) connection.release();
      
      console.error('Error fetching patient appointments:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch appointments'
      });
    }
  });

  // Endpoint for testing room generation
  app.get('/api/appointments/generate-room', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const roomId = generateRoomId();
    
    return res.json({
      roomId,
      webrtcUrl: `${BASE_URL}/api/webrtc/rooms/${roomId}`
    });
  });
  
  app.post('/api/webrtc/rooms/:roomId/join', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const { roomId } = req.params;
    const { pubkey } = req.user;

    console.log(`=== JOIN ROOM REQUEST ===`);
    console.log(`Room ID: ${roomId}`);
    console.log(`User pubkey: ${pubkey}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    let connection;
    
    try {
      connection = await pool.getConnection();

      const [rows] = await connection.execute(`
      SELECT a.*, u.nostr_pubkey, u.timezone 
      FROM appointments a 
      JOIN users u ON (u.id = a.id_users_provider OR u.id = a.id_users_customer)
      WHERE a.location = ? AND u.nostr_pubkey = ?
      `, [roomId, pubkey]);

      let joinResult; 

      const isAuthorized = rows.length > 0;
      console.log('checking appt rows: ', rows);
      const timeCheckResult = isAuthorized ? timeCheck(rows[0].start_datetime, rows[0].timezone) : false;
      console.log('timecheck result: ', timeCheckResult);
      
      if (!isAuthorized) { // !timeCheckResult
        connection.release();
      
        if (!isAuthorized) {
          console.error('Error, not authorized for room: ', roomId, pubkey);
          return res.status(403).json({ error: 'Not authorized for this room' });
        } else {
          console.error('Error, too early to join room: ', roomId, pubkey);
          return res.status(403).json({ error: 'Room not available yet. You can join 15 minutes before the appointment.' });
        }
      } else {
        const room = sessionManager.getRoom(roomId);
        
        let shouldInitiateOffer = false;
        
        if (room) {
          // Count currently connected participants (excluding the joining participant)
          const currentlyConnectedParticipants = Array.from(room.participants.values())
            .filter(p => p.status === 'connected' && p.pubkey !== pubkey);
          
          const connectedCount = currentlyConnectedParticipants.length;
          
          console.log(`Currently connected participants (excluding joiner): ${connectedCount}`);
          
          // If there are existing connected participants, this joiner should be the caller
          if (connectedCount > 0) {
            shouldInitiateOffer = true;
            console.log(`🔥 ROLE ASSIGNMENT: ${pubkey} will be CALLER (existing connected participants found)`);
          } else {
            shouldInitiateOffer = false;
            console.log(`🔥 ROLE ASSIGNMENT: ${pubkey} will be ANSWERER (first connected participant)`);
          }
        } else {
          // New room, first participant
          shouldInitiateOffer = true;
          console.log(`🔥 ROLE ASSIGNMENT: ${pubkey} will be ANSWERER (new room, first participant)`);
        }

        joinResult = sessionManager.handleParticipantJoin(roomId, pubkey);
        console.log(`Join result:`, joinResult);
        console.log(`Should initiate offer: ${shouldInitiateOffer}`);
        console.log(`Is rejoin: ${joinResult.isRejoin}`);
        
        broadcastParticipantCount(roomId);
        connection.release();
        console.log(`=== JOIN ROOM REQUEST COMPLETED ===`);

        return res.json({ 
          status: 'joined', // Always return 'joined', never 'rejoined'
          participants: joinResult.participantCount,
          roomInfo: joinResult.roomInfo,
          shouldInitiateOffer: shouldInitiateOffer // ✅ Use the new logic
        });
      }
    } catch (error) {
      if (connection) connection.release();
      console.error('Error in WebRTC join:', error);
      return res.status(500).json({ error: 'Failed to join room' });
    }
  });

  app.post('/api/webrtc/rooms/:roomId/leave', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const { roomId } = req.params;
    const { pubkey } = req.user;
    
    console.log(`=== LEAVE ROOM REQUEST ===`);
    console.log(`Room ID: ${roomId}`);
    console.log(`User pubkey: ${pubkey}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      const leaveResult = sessionManager.handleParticipantLeave(roomId, pubkey);
      
      console.log(`Leave result:`, leaveResult);
      
      console.log('About to broadcast for roomId:', roomId, 'type:', typeof roomId);
      broadcastParticipantCount(roomId);

      return res.json({ 
        status: 'left',
        participants: leaveResult.participantCount,
        roomExpiration: leaveResult.roomExpiration
      });
    } catch (error) {
      console.error('Error in WebRTC leave:', error);
      return res.status(500).json({ error: 'Failed to leave room' });
    }
    
    console.log(`=== LEAVE ROOM REQUEST COMPLETED ===`);
  });

  app.post('/api/webrtc/rooms/:roomId/reset-connection', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const { roomId } = req.params;
    
    try {
      const room = sessionManager.getRoom(roomId);
      if (room) {
        // Clear all connection state but keep participants
        delete room.pendingOffer;
        delete room.pendingAnswer;
        room.iceCandidates = [];
        
        console.log(`Connection reset for room ${roomId}`);
      }
      
      return res.json({ status: 'connection-reset' });
    } catch (error) {
      console.error('Error resetting connection:', error);
      return res.status(500).json({ error: 'Failed to reset connection' });
    }
  });

  app.post('/api/webrtc/rooms/:roomId/offer', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const { roomId } = req.params;
    const { offer } = req.body;
    const { pubkey } = req.user;
    
    try {
      const room = sessionManager.getRoom(roomId);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }
      
      sessionManager.setOffer(roomId, offer, pubkey);
      return res.json({ status: 'offer-sent' });
    } catch (error) {
      console.error('Error sending offer:', error);
      return res.status(500).json({ error: 'Failed to send offer' });
    }
  });

  app.get('/api/webrtc/rooms/:roomId/offer', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const { roomId } = req.params;
    
    try {
      const room = sessionManager.getRoom(roomId);
      return res.json({ offer: room?.pendingOffer || null });
    } catch (error) {
      console.error('Error getting offer:', error);
      return res.status(500).json({ error: 'Failed to get offer' });
    }
  });

  app.get('/api/webrtc/rooms/:roomId/answer', (req, res) => {
    // Extract token and validate
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const authResult = validateAuthToken(req, res);
      if (authResult && !authResult.success) {
        return authResult;
      }
    }

    const { roomId } = req.params;
    const room = sessionManager.getRoom(roomId);
    
    return res.json({ answer: room?.pendingAnswer || null });
  });

  app.post('/api/webrtc/rooms/:roomId/answer', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const { roomId } = req.params;
    const { answer } = req.body;
    const { pubkey } = req.user;
    
    try {
      const room = sessionManager.getRoom(roomId);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }
      
      room.pendingAnswer = { answer, from: pubkey, timestamp: Date.now() };
      
      return res.json({ status: 'answer-sent' });
    } catch (error) {
      console.error('Error sending answer:', error);
      return res.status(500).json({ error: 'Failed to send answer' });
    }
  });

  app.get('/api/webrtc/rooms/:roomId/answer', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const { roomId } = req.params;
    
    try {
      const room = sessionManager.getRoom(roomId);
      return res.json({ answer: room?.pendingAnswer || null });
    } catch (error) {
      console.error('Error getting answer:', error);
      return res.status(500).json({ error: 'Failed to get answer' });
    }
  });

  app.post('/api/webrtc/rooms/:roomId/ice-candidate', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const { roomId } = req.params;
    const { candidate } = req.body;
    const { pubkey } = req.user;
    
    try {
      const room = sessionManager.getRoom(roomId);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }
      
      if (!room.iceCandidates) room.iceCandidates = [];
      room.iceCandidates.push({ candidate, from: pubkey, timestamp: Date.now() });
      
      return res.json({ status: 'ice-candidate-sent' });
    } catch (error) {
      console.error('Error sending ICE candidate:', error);
      return res.status(500).json({ error: 'Failed to send ICE candidate' });
    }
  });

  app.get('/api/webrtc/rooms/:roomId/ice-candidates', async (req, res) => {
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }

    const { roomId } = req.params;
    const { pubkey } = req.user;
    
    try {
      const room = sessionManager.getRoom(roomId);
      
      if (!room || !room.iceCandidates) {
        return res.json({ candidates: [] });
      }
      
      // Return candidates from other participants
      const candidates = room.iceCandidates.filter(ic => ic.from !== pubkey);
      
      return res.json({ candidates });
    } catch (error) {
      console.error('Error getting ICE candidates:', error);
      return res.status(500).json({ error: 'Failed to get ICE candidates' });
    }
  });

  /* 
  * For SSE (Server-Sent Events), the token is passed as a query parameter because browsers 
  * can't send custom headers with EventSource connections.
  */
  app.get('/api/webrtc/rooms/:roomId/events', (req, res) => {
    console.log('/api/webrtc/rooms/:roomId/events, roomId:', req.params.roomId);

    // Extract token from query param for SSE and set it in the header for validateAuthToken
    const token = req.query.token;
    if (token) {
      req.headers.authorization = `Bearer ${token}`;
    }
    
    const authResult = validateAuthToken(req, res);
    if (authResult && !authResult.success) {
      return authResult;
    }
    
    try { 
      const { roomId } = req.params;      
      let controller;
      let connectionData;
      
      const stream = new ReadableStream({
        start(controllerRef) {
          controller = controllerRef;
          
          // Send initial participant count
          const room = sessionManager.getRoom(roomId);
          const participantCount = room ? Array.from(room.participants.values()).filter(p => p.status === 'connected').length : 0;
          
          const initialMessage = `data: ${JSON.stringify({ type: 'participant_count', count: participantCount })}\n\n`;
          controller.enqueue(new TextEncoder().encode(initialMessage));

          if (!sseConnections.has(roomId)) {
            sseConnections.set(roomId, new Set());
          }
          
          connectionData = { controller, closed: false, createdAt: Date.now() };
          sseConnections.get(roomId).add(connectionData);
          
          console.log('Added connection to sseConnections, total:', sseConnections.get(roomId).size);
        },
        cancel() {
          console.log('ReadableStream cancelled - cleaning up connection');
          if (connectionData) {
            connectionData.closed = true;
            const roomConnections = sseConnections.get(roomId);
            if (roomConnections) {
              roomConnections.delete(connectionData);
              if (roomConnections.size === 0) {
                sseConnections.delete(roomId);
              }
            }
          }
        }
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control'
        }
      });
    } catch (error) {
      console.error('Actual error in try block:', error);
      return res.status(401).json({ 
        status: 'error', 
        reason: 'WebRtc Route: Error' 
      });
    }
  });

  function broadcastParticipantCount(roomId) {
    console.log('=== BROADCAST PARTICIPANT COUNT START ===')
    console.log('Input roomId:', roomId, 'type:', typeof roomId);

    const room = sessionManager.getRoom(roomId);
    console.log('Room from sessionManager:', room ? 'EXISTS' : 'NULL');
    
    const participantCount = room ? Array.from(room.participants.values()).filter(p => p.status === 'connected').length : 0;
    console.log('Calculated participantCount:', participantCount);
    
    const connections = sseConnections.get(roomId);
    console.log('SSE connections for room:', connections ? connections.size : 'NO_CONNECTIONS');
    
    if (connections && connections.size > 0) {
      const message = `data: ${JSON.stringify({ type: 'participant_count', count: participantCount })}\n\n`;
      console.log('Message to broadcast:', message);
      
      connections.forEach(connectionData => {
        try {
          if (!connectionData.closed && connectionData.controller) {
            connectionData.controller.enqueue(new TextEncoder().encode(message));
          }
        } catch (error) {
          console.error('Error writing to SSE connection:', error);
          connectionData.closed = true;
          connections.delete(connectionData);
        }
      });
      console.log(`📡 Broadcasted participant count (${participantCount}) to ${connections.size} connected admin(s)`);
    } else {
      console.log('No SSE connections to broadcast to');
    }
    console.log('=== BROADCAST PARTICIPANT COUNT END ===');
  }

  console.log('WebRTC signaling routes initialized');
}