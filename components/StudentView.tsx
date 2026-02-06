import React, { useState, useEffect } from 'react';
import { ExamData, ExamStatus, QuestionType } from '../types';
import { Button } from './ui/Button';
import { sendAction } from '../services/syncService';
import { calculateScore } from '../services/scoring';

interface StudentViewProps {
  examData: ExamData;
  onBack: () => void;
  previewMode?: boolean; 
  initialStudentName?: string;
}

export const StudentView: React.FC<StudentViewProps> = ({ 
  examData, 
  onBack, 
  previewMode = false,
  initialStudentName = '' 
}) => {
  const [studentName, setStudentName] = useState(previewMode ? 'Giáo Viên (Xem thử)' : initialStudentName);
  const [joined, setJoined] = useState(previewMode || !!initialStudentName);
  const [studentId, setStudentId] = useState(previewMode ? 'teacher_preview' : '');
  
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState<string>('');
  
  const [answers, setAnswers] = useState<Record<number, any>>({});
  
  // ANTI-CHEAT STATE
  const [showCheatingWarning, setShowCheatingWarning] = useState(false);
  const [violationCount, setViolationCount] = useState(0); // Đếm lỗi cục bộ để hiển thị
  
  // Custom Confirmation Modal State
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  const [localFinished, setLocalFinished] = useState(false);
  const myStudentData = examData.students.find(s => s.id === studentId);
  const [previewFinished, setPreviewFinished] = useState(false);

  const isFinished = previewMode 
    ? previewFinished 
    : (localFinished || examData.status === ExamStatus.FINISHED || myStudentData?.finished);

  // LOGIC TỰ ĐỘNG JOIN
  useEffect(() => {
    if (initialStudentName && !previewMode && !studentId) {
        const newId = Date.now().toString();
        setStudentId(newId);
        sendAction({ 
            type: 'STUDENT_JOIN', 
            payload: { id: newId, name: initialStudentName } 
        });
        sendAction({ type: 'REQUEST_STATE' });
    }
  }, []);

  // Reset state khi IDLE
  useEffect(() => {
    if (!previewMode && examData.status === ExamStatus.IDLE) {
        setAnswers({});
        setLocalFinished(false);
        setCurrentQuestionIndex(0);
        setTimeLeft('');
        setShowSubmitConfirm(false);
        setViolationCount(0);
        setShowCheatingWarning(false);
    }
  }, [examData.status, previewMode]);

  // Request State loop
  useEffect(() => {
    if (previewMode) return; 

    let interval: any;
    if (joined && examData.questions.length === 0) {
        sendAction({ type: 'REQUEST_STATE' });
        interval = setInterval(() => {
            if (examData.questions.length === 0) {
                 sendAction({ type: 'REQUEST_STATE' });
            }
        }, 3000);
    }
    return () => clearInterval(interval);
  }, [joined, examData.questions.length, previewMode]);


  // Timer
  useEffect(() => {
    let interval: any;
    const isRunning = previewMode || (examData.status === ExamStatus.ACTIVE && examData.startTime);
    
    if (isRunning && !isFinished) {
        const start = examData.startTime || Date.now();
        const duration = examData.duration || 50;

        interval = setInterval(() => {
            const now = Date.now();
            const endTime = start + (duration * 60 * 1000);
            const diff = endTime - now;

            if (diff <= 0) {
                setTimeLeft("00:00");
                if (!previewMode) handleConfirmSubmit(); // Auto submit
            } else {
                const minutes = Math.floor(diff / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                setTimeLeft(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
            }
        }, 1000);
    }
    return () => clearInterval(interval);
  }, [examData.status, examData.startTime, examData.duration, isFinished, previewMode]);

  // --- LOGIC CHỐNG GIAN LẬN NÂNG CẤP ---
  useEffect(() => {
      if (previewMode) return;
      // Chỉ kích hoạt khi đang thi, đã vào phòng, và chưa nộp bài
      if (examData.status !== ExamStatus.ACTIVE || !joined || !studentId || isFinished) return;

      const handleVisibilityChange = () => {
          if (document.hidden) reportViolation();
      };
      const handleBlur = () => reportViolation();

      const reportViolation = () => {
          // 1. Gửi báo cáo về server giáo viên
          sendAction({ type: 'STUDENT_VIOLATION', payload: { studentId } });
          
          // 2. Tăng biến đếm cục bộ
          setViolationCount(prev => prev + 1);

          // 3. Hiện cảnh báo CHE MÀN HÌNH (Không dùng setTimeout để ẩn nữa)
          setShowCheatingWarning(true);
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('blur', handleBlur);

      return () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          window.removeEventListener('blur', handleBlur);
      };
  }, [examData.status, joined, studentId, isFinished, previewMode]);

  const handleResumeExam = () => {
      setShowCheatingWarning(false);
  };

  const handleJoin = () => {
    if (!studentName.trim()) return;
    const newId = Date.now().toString(); 
    setStudentId(newId);
    setJoined(true);
    if (!previewMode) {
        sendAction({ type: 'STUDENT_JOIN', payload: { id: newId, name: studentName } });
        sendAction({ type: 'REQUEST_STATE' });
    }
  };

  const submitAnswer = (questionId: number, val: any) => {
    if (isFinished) return; 
    const newAnswers = { ...answers, [questionId]: val };
    setAnswers(newAnswers);
    if (!previewMode) {
        sendAction({ type: 'STUDENT_ANSWER', payload: { studentId, questionId, answer: val } });
    }
  };

  const handlePressSubmit = () => {
      setShowSubmitConfirm(true);
  };

  const handleConfirmSubmit = () => {
      setShowSubmitConfirm(false);
      if (previewMode) {
          setPreviewFinished(true);
      } else {
          setLocalFinished(true);
          sendAction({ type: 'STUDENT_FINISH', payload: { studentId } });
      }
  };

  const handleManualSync = () => {
      if (previewMode) return;
      sendAction({ type: 'REQUEST_STATE' });
      alert("Đã gửi yêu cầu tải đề.");
  };

  // --- VIEW 1: Nhập tên (Fallback) ---
  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 relative">
        <button onClick={onBack} className="absolute top-4 left-4 p-2 rounded-full hover:bg-slate-200 text-slate-500 z-10">⬅️</button>
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-primary mb-2">Thông Tin Thí Sinh</h1>
            <p className="text-slate-500">Vui lòng nhập tên để bắt đầu</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Họ và Tên</label>
              <input type="text" value={studentName} onChange={(e) => setStudentName(e.target.value)} className="w-full px-4 py-3 rounded-lg border border-slate-300 outline-none" placeholder="Nhập tên..." />
            </div>
            <Button fullWidth onClick={handleJoin}>Xác nhận</Button>
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW 2: Chờ / Kết nối ---
  if (!previewMode && examData.status !== ExamStatus.ACTIVE && !isFinished) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-slate-50 relative">
        <button onClick={onBack} className="absolute top-4 left-4 p-2 rounded-lg bg-white border shadow-sm hover:bg-slate-50 text-slate-500 text-sm z-10">⬅️ Thoát</button>
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 max-w-sm w-full">
            <div className="w-16 h-16 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center mb-4 text-2xl animate-pulse mx-auto">⏳</div>
            <h2 className="text-xl font-bold text-slate-800">{examData.status === ExamStatus.IDLE ? 'Đang đợi giáo viên...' : 'Đang tải dữ liệu...'}</h2>
            <p className="text-slate-500 mt-2 text-sm">Xin chào <strong>{studentName}</strong></p>
            <div className="mt-6 space-y-3">
                <div className="text-xs text-slate-400 border-t border-slate-100 pt-4">Trạng thái: <span className="font-bold text-slate-600">{examData.status}</span></div>
                <Button variant="outline" fullWidth onClick={handleManualSync} className="text-xs h-8 bg-white">🔄 Tải lại đề thi</Button>
            </div>
        </div>
      </div>
    );
  }

  // --- VIEW 3: Kết quả ---
  if (isFinished) {
    const score = calculateScore(examData.questions, answers); 
    return (
      <div className="min-h-screen bg-slate-50 p-4 pb-20 relative overflow-y-auto">
        <button onClick={onBack} className="absolute top-4 left-4 p-2 rounded-lg bg-white border shadow-sm hover:bg-slate-50 text-slate-500 text-sm z-10">⬅️ Thoát</button>
        <div className="max-w-3xl mx-auto space-y-6 pt-10">
            <div className="bg-white p-6 rounded-2xl shadow-lg border-2 border-primary/10 text-center relative overflow-hidden">
                {previewMode && <div className="absolute top-0 right-0 bg-yellow-400 text-white text-xs font-bold px-2 py-1">PREVIEW</div>}
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-purple-500"></div>
                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl shadow-sm">🎉</div>
                <h2 className="text-2xl font-bold text-slate-800 mb-1">Kết Quả</h2>
                <p className="text-slate-500 mb-4">Thí sinh: <span className="font-semibold text-slate-900">{studentName}</span></p>
                <div className="inline-block bg-slate-50 px-8 py-4 rounded-xl border border-slate-200">
                    <span className="block text-sm text-slate-500 uppercase tracking-wide font-semibold">Tổng điểm</span>
                    <span className="block text-5xl font-black text-primary mt-1">{score.toFixed(2)}</span>
                    <span className="block text-xs text-slate-400 mt-2">Thang 10</span>
                </div>
                <div className="mt-6 flex justify-center">
                    {previewMode ? (
                        <Button onClick={() => setPreviewFinished(false)} variant="outline" className="text-sm">Làm lại</Button>
                    ) : (
                        <Button onClick={() => window.location.reload()} variant="outline" className="text-sm">Tải lại trang</Button>
                    )}
                </div>
            </div>
             <div className="space-y-6">
                  {examData.questions.map((q, idx) => {
                    const studentAns = answers[q.id];
                    return (
                        <div key={q.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                             <div className="flex justify-between items-start mb-3 border-b border-slate-100 pb-3">
                                <span className="bg-slate-100 text-slate-600 text-xs font-bold px-2 py-1 rounded">{q.type === QuestionType.MCQ ? 'Phần I' : q.type === QuestionType.TRUE_FALSE ? 'Phần II' : 'Phần III'}</span>
                                <span className="text-slate-400 font-bold text-sm">Câu {idx + 1}</span>
                            </div>
                            <div className="prose prose-sm max-w-none text-slate-800 mb-4" dangerouslySetInnerHTML={{ __html: q.text }} />
                             {q.type === QuestionType.MCQ && (
                                <div className="grid grid-cols-1 gap-2">
                                    {q.options?.map((opt, i) => {
                                        const isSelected = studentAns === i;
                                        const isCorrect = q.correctOption === i;
                                        let bgClass = "bg-white border-slate-200";
                                        let icon = null;
                                        if (isCorrect) { bgClass = "bg-green-50 border-green-500 ring-1 ring-green-500"; icon = "✅"; } 
                                        else if (isSelected && !isCorrect) { bgClass = "bg-red-50 border-red-500"; icon = "❌"; }
                                        return (
                                            <div key={i} className={`p-3 rounded-lg border text-sm flex items-center justify-between ${bgClass}`}>
                                                <div className="flex items-center gap-2">
                                                    <span className={`font-bold ${isCorrect ? 'text-green-700' : isSelected ? 'text-red-700' : 'text-slate-400'}`}>{String.fromCharCode(65 + i)}.</span>
                                                    <span>{opt}</span>
                                                </div>
                                                {icon && <span>{icon}</span>}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                             {/* ... TrueFalse and ShortAnswer rendering kept similar ... */}
                             {q.type === QuestionType.TRUE_FALSE && (
                                <div className="space-y-2">
                                    {q.statements?.map((stmt, i) => {
                                         const studentVal = Array.isArray(studentAns) ? studentAns[i] : null;
                                         const correctVal = q.correctTF?.[i];
                                         const isCorrect = studentVal === correctVal;
                                         return (
                                             <div key={i} className={`p-2 rounded border flex justify-between ${studentVal !== null && studentVal !== undefined ? (isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200') : 'bg-white'}`}>
                                                 <span className="text-sm mr-2 flex-1">{String.fromCharCode(97+i)}. {stmt}</span>
                                                 <div className="flex gap-2 text-xs font-bold">
                                                     <span className={studentVal === true ? 'text-blue-600' : 'text-slate-300'}>Đ</span>
                                                     <span className={studentVal === false ? 'text-blue-600' : 'text-slate-300'}>S</span>
                                                     {studentVal !== null && studentVal !== undefined && (<span>{isCorrect ? '✅' : '❌'}</span>)}
                                                 </div>
                                             </div>
                                         )
                                    })}
                                </div>
                             )}
                             {q.type === QuestionType.SHORT_ANSWER && (
                                 <div className="text-sm">Trả lời: <span className="font-bold">{studentAns}</span> <span className="ml-2 text-green-600 font-bold">(Đ/A: {q.correctShort})</span></div>
                             )}
                        </div>
                    );
                  })}
            </div>
        </div>
      </div>
    );
  }

  // --- VIEW 4: Đang thi ---
  const question = examData.questions[currentQuestionIndex];
  if (!question) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 relative">
             {previewMode && <button onClick={onBack} className="absolute top-4 left-4 p-2 rounded-lg bg-white border shadow-sm hover:bg-slate-50 text-slate-500 text-sm z-10">⬅️ Thoát</button>}
             <div className="text-center">
                 <p className="text-slate-500 mb-4">{previewMode ? "Đề thi trống." : "Đang tải đề thi..."}</p>
                 {!previewMode && <Button onClick={handleManualSync}>Tải lại ngay</Button>}
             </div>
        </div>
      );
  }

  const renderContent = () => {
    switch(question.type) {
      case QuestionType.MCQ:
        return (
          <div className="grid grid-cols-2 gap-3 max-w-md mx-auto w-full">
            {question.options?.map((opt, idx) => {
              const isSelected = answers[question.id] === idx;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    submitAnswer(question.id, idx);
                    setTimeout(() => { if (currentQuestionIndex < examData.questions.length - 1) setCurrentQuestionIndex(prev => prev + 1); }, 400);
                  }}
                  className={`h-16 rounded-xl font-bold text-lg transition-all relative flex items-center justify-center border-2 ${isSelected ? 'bg-primary border-primary text-white shadow-lg' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="absolute left-3 top-2 text-xs opacity-60 font-normal">{String.fromCharCode(65 + idx)}</span>
                  {opt}
                </button>
              )
            })}
          </div>
        );
      case QuestionType.TRUE_FALSE:
        const currentTF = answers[question.id] || [null, null, null, null];
        return (
          <div className="space-y-3 w-full max-w-lg mx-auto">
            {question.statements?.map((stmt, idx) => (
              <div key={idx} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between gap-3">
                <div className="flex-1 text-sm text-slate-700"><span className="font-bold mr-1">{String.fromCharCode(97 + idx)}.</span> {stmt}</div>
                <div className="flex bg-slate-100 rounded-lg p-1 shrink-0">
                  <button onClick={() => { const newTF = [...currentTF]; newTF[idx] = true; submitAnswer(question.id, newTF); }} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${currentTF[idx] === true ? 'bg-green-500 text-white' : 'text-slate-500 hover:bg-slate-200'}`}>Đ</button>
                  <button onClick={() => { const newTF = [...currentTF]; newTF[idx] = false; submitAnswer(question.id, newTF); }} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${currentTF[idx] === false ? 'bg-red-500 text-white' : 'text-slate-500 hover:bg-slate-200'}`}>S</button>
                </div>
              </div>
            ))}
          </div>
        );
      case QuestionType.SHORT_ANSWER:
        return (
          <div className="w-full max-w-sm mx-auto mt-4">
             <input type="number" step="0.01" placeholder="Nhập số..." className="w-full text-center text-3xl font-bold p-4 rounded-xl border-2 border-slate-300 focus:border-primary outline-none" value={answers[question.id] || ''} onChange={(e) => { const val = parseFloat(e.target.value); submitAnswer(question.id, isNaN(val) ? '' : val); }} />
             <p className="text-center text-slate-400 text-sm mt-2">Nhập kết quả dưới dạng số</p>
          </div>
        );
    }
  };

  return (
    // FIX LAYOUT: Dùng h-screen và overflow-hidden để cố định khung hình, tránh lỗi scroll
    <div className="h-screen w-full flex flex-col bg-slate-50 relative overflow-hidden">
      
      {/* Modal xác nhận nộp bài tùy chỉnh */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-bounce-short">
                <h3 className="text-xl font-bold text-slate-800 mb-2">Nộp bài thi?</h3>
                <p className="text-slate-600 mb-6">Bạn có chắc chắn muốn nộp bài? <br/>Điểm số sẽ được hiển thị ngay lập tức.</p>
                <div className="flex gap-3">
                    <Button variant="outline" fullWidth onClick={() => setShowSubmitConfirm(false)}>Quay lại</Button>
                    <Button variant="danger" fullWidth onClick={handleConfirmSubmit}>Nộp ngay</Button>
                </div>
            </div>
        </div>
      )}

      {/* CẢNH BÁO GIAN LẬN NÂNG CẤP (Sticky) */}
      {!previewMode && showCheatingWarning && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-red-600/95 backdrop-blur-md p-6">
              <div className="bg-white p-8 rounded-2xl text-center shadow-2xl max-w-sm w-full animate-pulse-short border-4 border-red-500">
                  <div className="text-6xl mb-4">⚠️</div>
                  <h2 className="text-2xl font-black text-red-600 mb-2 uppercase">Phát hiện gian lận!</h2>
                  <p className="text-slate-700 font-medium mb-4">
                      Hệ thống phát hiện bạn đã rời khỏi màn hình làm bài thi.
                  </p>
                  
                  <div className="bg-red-50 p-4 rounded-lg mb-6 border border-red-100">
                      <p className="text-xs text-red-500 uppercase font-bold mb-1">Số lần vi phạm</p>
                      <p className="text-4xl font-black text-red-700">{violationCount}</p>
                  </div>
                  
                  <p className="text-xs text-slate-500 mb-6 italic">
                      Giáo viên đã được thông báo về hành động này.
                  </p>

                  <Button fullWidth variant="danger" onClick={handleResumeExam}>
                      Tôi xin cam kết quay lại làm bài
                  </Button>
              </div>
          </div>
      )}

      {/* Top Bar */}
      <div className="bg-white px-4 py-3 shadow-sm flex-none z-10 flex justify-between items-center border-b border-slate-200">
        <div className="flex items-center gap-2">
            <button onClick={onBack} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500 mr-1">⬅️</button>
            <div className="flex flex-col">
                <span className="font-bold text-slate-700 truncate max-w-[100px] sm:max-w-[150px]">{studentName}</span>
                <div className="flex gap-1">
                    {previewMode && <span className="text-[10px] text-yellow-600 font-bold bg-yellow-100 px-1 rounded">PREVIEW</span>}
                    {timeLeft && <span className="text-xs font-mono font-bold text-yellow-600 bg-yellow-50 px-1 rounded">⏱️ {timeLeft}</span>}
                </div>
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-primary mr-1">Câu {currentQuestionIndex + 1}</span>
            <Button variant="danger" className="py-2 px-4 text-xs sm:text-sm font-bold shadow-sm" onClick={handlePressSubmit}>
                Nộp bài
            </Button>
        </div>
      </div>

      {/* Question Area - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 pb-32 w-full max-w-3xl mx-auto">
        {/* FIX DISPLAY: Bỏ items-center/text-center, dùng text-left/justify */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-6">
            <div 
                className="text-lg text-slate-800 leading-relaxed prose prose-slate max-w-none text-left"
                dangerouslySetInnerHTML={{ __html: question.text }}
            />
        </div>
        
        {renderContent()}
      </div>

      {/* Bottom Navigation */}
      <div className="flex-none bg-white border-t border-slate-200 p-4 pb-6 z-20">
        <div className="flex justify-between items-center mb-4 max-w-3xl mx-auto">
          <Button variant="outline" disabled={currentQuestionIndex === 0} onClick={() => setCurrentQuestionIndex(p => p - 1)}>Trước</Button>
          <span className="text-xs text-slate-400">{answers[question.id] !== undefined ? 'Đã làm' : 'Chưa làm'}</span>
          <Button variant="primary" disabled={currentQuestionIndex === examData.questions.length - 1} onClick={() => setCurrentQuestionIndex(p => p + 1)}>Tiếp</Button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2 no-scrollbar px-2 max-w-3xl mx-auto">
            {examData.questions.map((q, idx) => {
                let isAnswered = answers[q.id] !== undefined;
                if (q.type === QuestionType.TRUE_FALSE) isAnswered = Array.isArray(answers[q.id]) && answers[q.id].some((x:any) => x !== null);
                return (
                  <div key={q.id} onClick={() => setCurrentQuestionIndex(idx)} className={`w-8 h-1.5 rounded-full flex-shrink-0 cursor-pointer transition-all ${idx === currentQuestionIndex ? 'bg-primary' : isAnswered ? 'bg-green-400' : 'bg-slate-200'}`} />
                );
            })}
        </div>
      </div>
    </div>
  );
};