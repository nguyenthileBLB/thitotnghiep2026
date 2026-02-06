import React, { useState, useEffect, useRef } from 'react';
import { TeacherDashboard } from './components/TeacherDashboard';
import { StudentView } from './components/StudentView';
import { ExamData, ExamStatus, BroadcastAction } from './types';
import { initHost, initClient, sendAction, closeSync } from './services/syncService';
import { calculateScore } from './services/scoring';
import { Button } from './components/ui/Button';

// Initial state
const initialExamState: ExamData = {
  examId: '', 
  title: '',
  questions: [], 
  packs: [],     
  status: ExamStatus.IDLE,
  students: [],
  duration: 50 // Mặc định 50 phút
};

const STORAGE_KEY = 'exam_app_data_v1';

const App: React.FC = () => {
  const [role, setRole] = useState<'teacher' | 'student' | null>(null);
  const [roomId, setRoomId] = useState<string>(''); // ID phòng thi (Chỉ hiển thị 6 số)
  
  // State Input cho Học sinh
  const [inputRoomId, setInputRoomId] = useState(''); 
  const [inputStudentName, setInputStudentName] = useState('');

  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  
  // Modal State
  const [showExitModal, setShowExitModal] = useState(false);

  // Initialize state from LocalStorage to persist data on reload
  const [examData, setExamData] = useState<ExamData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
          const parsed = JSON.parse(saved);
          return { ...initialExamState, ...parsed };
      }
      return initialExamState;
    } catch (e) {
      console.error("Failed to load exam data", e);
      return initialExamState;
    }
  });

  // Ref để truy cập state mới nhất trong callback của PeerJS
  const examDataRef = useRef(examData);
  useEffect(() => {
      examDataRef.current = examData;
      // Persist to LocalStorage
      if (role === 'teacher') {
         localStorage.setItem(STORAGE_KEY, JSON.stringify(examData));
      }
  }, [examData, role]);

  // Helper function: Lấy state an toàn để gửi cho học sinh
  const getSanitizedStateForStudent = () => {
      const fullState = examDataRef.current;
      return {
          examId: fullState.examId,
          title: fullState.title,
          questions: fullState.questions, 
          status: fullState.status,
          startTime: fullState.startTime,
          duration: fullState.duration,
          students: [], 
          packs: [] 
      };
  };

  // Hàm xử lý tin nhắn chung
  const handleMessage = (action: BroadcastAction) => {
    switch (action.type) {
        case 'REQUEST_STATE':
          if (role === 'teacher') {
             sendAction({ type: 'SYNC_STATE', payload: getSanitizedStateForStudent() });
          }
          break;

        case 'SYNC_STATE':
          setExamData(prev => ({ ...prev, ...action.payload }));
          break;
        
        case 'RESET':
          setExamData(initialExamState);
          break;
        
        case 'STUDENT_JOIN':
          setExamData(prev => {
             const currentStudents = Array.isArray(prev.students) ? prev.students : [];
             const exists = currentStudents.find(s => s.id === action.payload.id);
             if (exists) return prev;
             
             const newData = {
                 ...prev,
                 students: [...currentStudents, { ...action.payload, answers: {}, score: 0, finished: false, violationCount: 0 }]
             };
             setTimeout(() => sendAction({ type: 'SYNC_STATE', payload: newData }), 100);
             return newData;
          });
          break;
        
        case 'STUDENT_ANSWER':
           setExamData(prev => {
               const currentStudents = Array.isArray(prev.students) ? prev.students : [];
               const studentIndex = currentStudents.findIndex(s => s.id === action.payload.studentId);
               if (studentIndex === -1) return prev;
               
               const updatedStudents = [...currentStudents];
               const student = { ...updatedStudents[studentIndex] };
               
               student.answers = { ...student.answers, [action.payload.questionId]: action.payload.answer };
               student.score = calculateScore(prev.questions, student.answers);
               
               updatedStudents[studentIndex] = student;
               return { ...prev, students: updatedStudents };
           });
           break;
        
        case 'STUDENT_VIOLATION':
           setExamData(prev => {
               const currentStudents = Array.isArray(prev.students) ? prev.students : [];
               const studentIndex = currentStudents.findIndex(s => s.id === action.payload.studentId);
               if (studentIndex === -1) return prev;
               
               const updatedStudents = [...currentStudents];
               const student = { ...updatedStudents[studentIndex] };
               
               student.violationCount = (student.violationCount || 0) + 1;
               
               updatedStudents[studentIndex] = student;
               return { ...prev, students: updatedStudents };
           });
           break;
        
        case 'STUDENT_FINISH':
           setExamData(prev => {
               const currentStudents = Array.isArray(prev.students) ? prev.students : [];
               const studentIndex = currentStudents.findIndex(s => s.id === action.payload.studentId);
               if (studentIndex === -1) return prev;
               
               const updatedStudents = [...currentStudents];
               const student = { ...updatedStudents[studentIndex] };
               
               student.finished = true; 
               
               updatedStudents[studentIndex] = student;
               return { ...prev, students: updatedStudents };
           });
           break;
      }
  };

  const startTeacherSession = async () => {
      setIsConnecting(true);
      try {
          const code = await initHost(handleMessage, getSanitizedStateForStudent);
          setRoomId(code);
          setRole('teacher');
      } catch (e) {
          console.error(e);
          setConnectionError("Không thể tạo phòng. Vui lòng thử lại.");
      } finally {
          setIsConnecting(false);
      }
  };

  const joinStudentSession = async () => {
      if (!inputStudentName.trim()) {
          setConnectionError("Vui lòng nhập họ tên của bạn");
          return;
      }
      if (!inputRoomId.trim() || inputRoomId.length !== 6) {
          setConnectionError("Mã phòng phải gồm 6 chữ số");
          return;
      }
      setExamData(initialExamState);
      setIsConnecting(true);
      setConnectionError('');
      try {
          await initClient(inputRoomId.trim(), handleMessage);
          setRole('student');
      } catch (e) {
          console.error(e);
          const msg = (e as Error).message || "Không tìm thấy phòng thi";
          setConnectionError(msg);
      } finally {
          setIsConnecting(false);
      }
  };

  const handleHardReset = () => {
      if (confirm('Bạn có chắc muốn xóa toàn bộ dữ liệu ứng dụng để khôi phục trạng thái ban đầu?')) {
          localStorage.clear();
          closeSync();
          window.location.reload();
      }
  };

  // Trigger Modal
  const handleExitRequest = () => {
      setShowExitModal(true);
  };

  // Thực hiện thoát sau khi xác nhận
  const confirmExit = () => {
      setShowExitModal(false);
      closeSync();
      setRole(null);
      setRoomId('');
      setInputRoomId('');
      setInputStudentName('');
      setConnectionError('');
      if (role === 'student') {
           setExamData(initialExamState);
      }
  };

  // Role Selection Screen
  if (!role) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full grid md:grid-cols-2 gap-8">
          
          {/* Intro Card */}
          <div className="flex flex-col justify-center space-y-4">
            <h1 className="text-4xl font-bold text-slate-900">Thi Hóa Học 2025</h1>
            <p className="text-lg text-slate-600">
              Hệ thống thi thử THPT Quốc Gia hỗ trợ đa thiết bị.
            </p>
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800">
              <strong>Cấu trúc đề thi mới:</strong>
              <ul className="list-disc ml-5 mt-1 space-y-1 text-xs">
                <li><b>Phần I:</b> Trắc nghiệm 4 đáp án (18 câu - 0.25đ/câu).</li>
                <li><b>Phần II:</b> Đúng/Sai (4 câu - Max 1.0đ/câu).</li>
                <li><b>Phần III:</b> Trả lời ngắn (6 câu - 0.25đ/câu).</li>
              </ul>
            </div>
            
             <div className="pt-4">
                <button onClick={handleHardReset} className="text-xs text-slate-400 hover:text-red-500 underline">
                    ⚠️ Xóa dữ liệu & Làm mới
                </button>
            </div>
          </div>

          {/* Selection Cards */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-3">
                     <div className="w-10 h-10 bg-indigo-100 text-primary rounded-lg flex items-center justify-center">🎓</div>
                     <h3 className="text-xl font-bold text-slate-800">Giáo Viên</h3>
                </div>
                <p className="text-slate-500 text-sm mb-4">Tạo phòng thi và quản lý học sinh.</p>
                <Button fullWidth onClick={startTeacherSession} disabled={isConnecting}>
                    {isConnecting ? 'Đang tạo phòng...' : 'Tạo Phòng Thi Mới'}
                </Button>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-3">
                     <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center">✏️</div>
                     <h3 className="text-xl font-bold text-slate-800">Học Sinh</h3>
                </div>
                
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-bold text-slate-500 block mb-1">Họ và Tên</label>
                        <input 
                            type="text" 
                            placeholder="Nhập tên của bạn..." 
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                            value={inputStudentName}
                            onChange={(e) => setInputStudentName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 block mb-1">Mã Phòng</label>
                        <input 
                            type="text" 
                            maxLength={6}
                            placeholder="Nhập 6 số (VD: 123456)" 
                            className="w-full px-3 py-2 border rounded-lg text-sm text-center font-mono tracking-widest text-lg focus:ring-2 focus:ring-emerald-500 outline-none uppercase"
                            value={inputRoomId}
                            onChange={(e) => setInputRoomId(e.target.value.replace(/[^0-9]/g, ''))}
                        />
                    </div>
                    {connectionError && <p className="text-red-500 text-xs">{connectionError}</p>}
                    <Button fullWidth variant="secondary" onClick={joinStudentSession} disabled={isConnecting}>
                        {isConnecting ? 'Đang kết nối...' : 'Vào Phòng Thi'}
                    </Button>
                </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 relative">
      {/* Hiển thị Room ID cho GV */}
      {role === 'teacher' && (
          <div className="bg-indigo-900 text-white px-4 py-2 text-center text-sm shadow-md flex justify-center items-center gap-4 relative z-50">
              <div className="flex items-center gap-4">
                  <span>🔒 Mã Phòng Thi: <strong className="font-mono text-yellow-300 text-2xl tracking-widest select-all cursor-pointer" onClick={() => navigator.clipboard.writeText(roomId)} title="Nhấn để copy">{roomId}</strong></span>
                  <button 
                    onClick={() => {navigator.clipboard.writeText(roomId); alert("Đã copy mã phòng!")}}
                    className="bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded text-xs"
                  >
                      Copy
                  </button>
              </div>
          </div>
      )}

      {role === 'teacher' ? (
        <TeacherDashboard examData={examData} setExamData={setExamData} onBack={handleExitRequest} />
      ) : (
        <StudentView 
            examData={examData} 
            onBack={handleExitRequest} 
            initialStudentName={inputStudentName} 
        />
      )}

      {/* Modal xác nhận thoát chung cho cả 2 vai trò */}
      {showExitModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-scale-up">
                <h3 className="text-xl font-bold text-slate-800 mb-2">
                    {role === 'teacher' ? 'Kết thúc phiên làm việc?' : 'Rời khỏi phòng thi?'}
                </h3>
                <p className="text-slate-600 mb-6 text-sm">
                    {role === 'teacher' 
                        ? 'Mã phòng thi sẽ bị hủy và kết nối với học sinh sẽ bị ngắt.' 
                        : 'Bạn sẽ trở về màn hình chính. Kết quả làm bài có thể bị mất nếu chưa nộp.'}
                </p>
                <div className="flex gap-3">
                    <Button variant="outline" fullWidth onClick={() => setShowExitModal(false)}>Hủy</Button>
                    <Button variant="danger" fullWidth onClick={confirmExit}>
                        {role === 'teacher' ? 'Kết thúc' : 'Rời phòng'}
                    </Button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default App;