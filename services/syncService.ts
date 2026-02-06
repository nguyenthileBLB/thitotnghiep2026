import Peer, { DataConnection, PeerJSOption } from 'peerjs';
import { BroadcastAction } from '../types';

// Định nghĩa tiền tố ẩn để tránh trùng lặp trên server công cộng
const APP_PREFIX = 'examsync-2025-';

// Cấu hình STUN server của Google để hỗ trợ kết nối xuyên NAT/Firewall
// Đây là chìa khóa để HS và GV nhìn thấy nhau trên các mạng khác nhau (3G vs Wifi)
const peerConfig: PeerJSOption = {
  debug: 1, // 0: None, 1: Errors, 2: Warnings, 3: All
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  }
};

let peer: Peer | null = null;
let connections: DataConnection[] = []; // Dành cho GV: danh sách kết nối tới HS
let hostConnection: DataConnection | null = null; // Dành cho HS: kết nối tới GV

/**
 * Hàm hỗ trợ tạo mã 6 chữ số ngẫu nhiên
 */
const generateRoomCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Khởi tạo chế độ Host (Giáo viên)
 * Tự động retry nếu mã 6 số bị trùng
 */
export const initHost = (
  onMessage: (action: BroadcastAction) => void,
  getLatestState: () => any
): Promise<string> => {
  return new Promise((resolve, reject) => {
    closeSync(); // Reset trước khi init

    const tryCreatePeer = () => {
      const code = generateRoomCode();
      const fullId = `${APP_PREFIX}${code}`;
      
      // Sử dụng config có STUN
      const tempPeer = new Peer(fullId, peerConfig);

      // Xử lý khi kết nối thành công
      tempPeer.on('open', () => {
        console.log('Host initialized with 6-digit Code:', code);
        peer = tempPeer;
        setupHostListeners(peer, onMessage, getLatestState);
        resolve(code); // Chỉ trả về 6 số cho UI hiển thị
      });

      // Xử lý lỗi (đặc biệt là lỗi trùng ID)
      tempPeer.on('error', (err: any) => {
        if (err.type === 'unavailable-id') {
          console.log(`Code ${code} taken, retrying...`);
          tempPeer.destroy();
          tryCreatePeer(); // Thử lại đệ quy với số khác
        } else {
          console.error('Peer creation error:', err);
          if (!peer) reject(err); 
        }
      });
    };

    tryCreatePeer();
  });
};

const setupHostListeners = (
    p: Peer, 
    onMessage: (action: BroadcastAction) => void,
    getLatestState: () => any
) => {
    p.on('connection', (conn) => {
      console.log('Student connected:', conn.peer);
      connections.push(conn);

      // Khi có HS mới kết nối, gửi ngay State hiện tại
      conn.on('open', () => {
         // Lấy state đã được filter (chỉ data cần thiết cho HS)
         const currentState = getLatestState();
         // Delay nhỏ để đảm bảo kết nối ổn định trước khi bắn data
         setTimeout(() => {
             if (conn.open) {
                conn.send({ type: 'SYNC_STATE', payload: currentState });
             }
         }, 500);
      });

      conn.on('data', (data) => {
        onMessage(data as BroadcastAction);
      });

      conn.on('close', () => {
        connections = connections.filter(c => c !== conn);
      });
      
      conn.on('error', (err) => {
        console.error("Connection error:", err);
        connections = connections.filter(c => c !== conn);
      });
    });
};

/**
 * Khởi tạo chế độ Client (Học sinh)
 * @param inputCode Mã 6 số học sinh nhập
 */
export const initClient = (
  inputCode: string,
  onMessage: (action: BroadcastAction) => void
): Promise<void> => {
  return new Promise((resolve, reject) => {
    closeSync();

    // Config client cũng cần STUN để traverse NAT
    peer = new Peer(peerConfig);

    // Timeout: Nếu 15s không connect được thì báo lỗi
    const timeout = setTimeout(() => {
        if (!hostConnection || !hostConnection.open) {
            reject(new Error("Kết nối quá hạn (Timeout). Vui lòng thử lại."));
            closeSync();
        }
    }, 15000);

    peer.on('open', () => {
      if (!peer) return;
      
      // Ghép tiền tố để tìm đúng phòng giáo viên
      const hostId = `${APP_PREFIX}${inputCode}`;
      console.log('Attempting to connect to host:', hostId);

      // reliable: true giúp PeerJS cố gắng gửi lại gói tin nếu mất
      const conn = peer.connect(hostId, { reliable: true });

      conn.on('open', () => {
        clearTimeout(timeout);
        console.log('Connected to host:', hostId);
        hostConnection = conn;
        // Gửi ngay yêu cầu lấy dữ liệu để đảm bảo (Double check)
        conn.send({ type: 'REQUEST_STATE' });
        resolve();
      });

      conn.on('data', (data) => {
        onMessage(data as BroadcastAction);
      });

      conn.on('error', (err) => {
        console.error('Connection to host failed', err);
        // Không reject ở đây vì peer.on('error') sẽ bắt lỗi chính
      });
      
      conn.on('close', () => {
          console.log("Connection closed");
      });
    });

    peer.on('error', (err: any) => {
      clearTimeout(timeout);
      console.error('Peer error:', err);
      
      // Lỗi quan trọng nhất: Không tìm thấy ID phòng
      if (err.type === 'peer-unavailable') {
          reject(new Error(`Không tìm thấy phòng thi ${inputCode}. Vui lòng kiểm tra mã hoặc đảm bảo GV đang mở phòng.`));
      } else if (err.type === 'network') {
           reject(new Error("Lỗi mạng. Vui lòng kiểm tra kết nối internet."));
      } else {
           reject(err);
      }
    });
  });
};

export const sendAction = (action: BroadcastAction) => {
  // Logic gửi của Host (GV)
  if (connections.length > 0) {
    connections.forEach(conn => {
      if (conn.open) {
        conn.send(action);
      }
    });
  }

  // Logic gửi của Client (HS)
  if (hostConnection && hostConnection.open) {
    hostConnection.send(action);
  }
};

export const closeSync = () => {
  if (peer) {
    peer.destroy();
    peer = null;
  }
  connections = [];
  hostConnection = null;
};