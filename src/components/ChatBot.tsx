
import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader2, Eraser, MessageSquare } from 'lucide-react';
import { createChatSession } from '../services/geminiService';

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

const ChatBot: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'model',
      text: 'Hello! I am your AutoTally Assistant. I specialize in Tally Prime XML, Indian GST laws, and accounting automation. How can I help you today?',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatSessionRef = useRef<any | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initializeChat = async () => {
      try {
        console.log('ChatBot: Initializing chat session...');
        chatSessionRef.current = createChatSession();
        console.log('ChatBot: Session created successfully');
      } catch (e) {
        console.error("Failed to initialize chat session", e);
        const errorMsg: Message = {
          id: Date.now().toString(),
          role: 'model',
          text: 'Unable to initialize AI chat. Please check your backend connection.',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    };

    initializeChat();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    if (!chatSessionRef.current) {
      try {
        chatSessionRef.current = createChatSession();
      } catch (e) {
        const errorMsg: Message = {
          id: (Date.now()).toString(),
          role: 'model',
          text: "AI Chat Engine unavailable. Please check your backend connection.",
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMsg]);
        return;
      }
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const result = await chatSessionRef.current.sendMessage({ message: userMsg.text });
      const responseText = result.text;

      const modelMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText || "I encountered an error while processing your request.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, modelMsg]);
    } catch (error) {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: "Sorry, I lost connection to the AI engine. Please check your internet or try again later.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const resetChat = () => {
    try {
      chatSessionRef.current = createChatSession();
      setMessages([{
        id: Date.now().toString(),
        role: 'model',
        text: 'Chat history cleared. What else would you like to know?',
        timestamp: new Date()
      }]);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 h-full flex flex-col overflow-hidden animate-fade-in transition-all">
      {/* High-fidelity Header */}
      <div className="p-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white leading-none">AutoTally Assistant</h3>
            <div className="flex items-center gap-1.5 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Always Online</span>
            </div>
          </div>
        </div>
        <button
          onClick={resetChat}
          className="text-slate-400 hover:text-red-500 transition-colors p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 border border-transparent hover:border-slate-300 dark:hover:border-slate-600"
          title="Clear Chat History"
        >
          <Eraser className="w-4 h-4" />
        </button>
      </div>

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30 dark:bg-slate-900/20 scrollbar-hide">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm border
                ${msg.role === 'user'
                ? 'bg-slate-900 text-white border-slate-800'
                : 'bg-white dark:bg-slate-800 text-indigo-600 border-slate-100 dark:border-slate-700'}
            `}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div className={`
              max-w-[75%] rounded-2xl px-5 py-3 text-sm shadow-sm leading-relaxed
              ${msg.role === 'user'
                ? 'bg-indigo-600 text-white rounded-tr-none'
                : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-none border border-slate-200 dark:border-slate-700'}
            `}>
              <div className="whitespace-pre-wrap">{msg.text}</div>
              <div className={`text-[10px] mt-2 font-bold uppercase tracking-widest opacity-40 ${msg.role === 'user' ? 'text-indigo-100' : 'text-slate-400'}`}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 text-indigo-600 border border-slate-100 dark:border-slate-700 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-tl-none px-5 py-3 shadow-sm border border-slate-200 dark:border-slate-700 flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Assistant is thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Composer */}
      <div className="p-5 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 shrink-0">
        <div className="flex items-end gap-3 relative max-w-4xl mx-auto">
          <div className="relative flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about Tally, GST, or specific transaction mappings..."
              className="w-full pl-5 pr-12 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none max-h-48 min-h-[56px] scrollbar-hide dark:text-white shadow-inner transition-all"
              rows={1}
            />
            <div className="absolute left-0 bottom-full mb-2 w-full flex justify-center pointer-events-none">
              <div className="bg-slate-800/80 backdrop-blur text-white text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-widest opacity-0 group-focus-within:opacity-100 transition-opacity">
                Press Enter to send
              </div>
            </div>
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-indigo-600/20 active:scale-95 flex-shrink-0 mb-1"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        <div className="text-[10px] text-center text-slate-400 font-bold uppercase tracking-widest mt-4">
          <MessageSquare className="w-3 h-3 inline mr-1 mb-0.5 opacity-50" />
          Expert System • Accounting Domain Specific
        </div>
      </div>
    </div>
  );
};

export default ChatBot;
