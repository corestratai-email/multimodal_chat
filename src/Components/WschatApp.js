import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import './WschatApp.css';
import axios from 'axios';

function WschatApp() {
  const [models, setModels] = useState({});
  const [selectedModel, setSelectedModel] = useState('');
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [recommendation, setRecommendation] = useState(null);
  const [contextHistory, setContextHistory] = useState([]);
  const [showContext, setShowContext] = useState(false);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [useWebSocket, setUseWebSocket] = useState(true);
  const messagesEndRef = useRef(null);

  // SocketIO refs
  const socketRef = useRef(null);
  const retryRef = useRef(0);
  const timerRef = useRef(null);

  const CodeBlock = ({ language, value }) => {
    return (
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          margin: '1rem 0',
          borderRadius: '8px',
          fontSize: '14px'
        }}
        showLineNumbers={true}
        wrapLines={true}
      >
        {value}
      </SyntaxHighlighter>
    );
  };

  const getRecommendation = async () => {
    if (!inputMessage.trim()) {
      alert('Please enter a message first to get a model recommendation.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/recommend`, {
        message: inputMessage
      });
      
      setRecommendation(response.data);
      setSelectedModel(response.data.recommended_model);
    } catch (error) {
      console.error('Error getting recommendation:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // WebSocket message logging
  const [wsMessages, setWsMessages] = useState([]);
  const [showWsLog, setShowWsLog] = useState(false);
  const wsLogRef = useRef(null);

  const API_BASE_URL = 'https://multimodel-dfazgpgugneff4cr.eastus-01.azurewebsites.net/api';
  const SOCKET_URL = 'https://multimodel-dfazgpgugneff4cr.eastus-01.azurewebsites.net';

  // Enhanced logging function
  const logWsMessage = (direction, event, data, timestamp = new Date()) => {
    const logEntry = {
      id: Date.now() + Math.random(),
      direction,
      event,
      data: JSON.stringify(data, null, 2),
      timestamp: timestamp.toLocaleTimeString(),
      rawData: data
    };

    setWsMessages(prev => [...prev.slice(-50), logEntry]);

    const symbol = direction === 'sent' ? '📤' : '📥';
    console.group(`${symbol} WebSocket ${direction.toUpperCase()}: ${event}`);
    console.log('Timestamp:', timestamp.toLocaleTimeString());
    console.log('Event:', event);
    console.log('Data:', data);
    console.groupEnd();
  };

  const clearWsLog = () => {
    setWsMessages([]);
  };

  const fetchModels = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/models`);
      const data = await response.json();
      setModels(data.models);
      const firstModel = Object.keys(data.models)[0];
      if (!selectedModel) {
        setSelectedModel(firstModel);
      }
    } catch (error) {
      console.error('Error fetching models:', error);
      if (useWebSocket && socketRef.current && socketRef.current.connected) {
        sendSocketMessage('get_models');
      }
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (wsLogRef.current) {
      wsLogRef.current.scrollTop = wsLogRef.current.scrollHeight;
    }
  }, [wsMessages]);

  useEffect(() => {
    if (!window.io) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.2/socket.io.js';
      script.onload = () => {
        console.log('Socket.IO client loaded from CDN');
        if (useWebSocket) {
          connect();
        }
      };
      script.onerror = () => {
        console.error('Failed to load Socket.IO client from CDN');
      };
      document.head.appendChild(script);
    } else if (useWebSocket) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [useWebSocket]);

  const connect = () => {
    if (socketRef.current && socketRef.current.connected) {
      return;
    }

    setWsStatus("connecting");
    logWsMessage('sent', 'connection_attempt', { url: SOCKET_URL });

    if (!window.io) {
      console.error('Socket.IO client not loaded. Please include: <script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.2/socket.io.js"></script>');
      setWsStatus("disconnected");
      return;
    }

    const socket = window.io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true,
      autoConnect: false
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      logWsMessage('received', 'connect', { status: 'connected' });
      setWsStatus("connected");
      retryRef.current = 0;

      socket.emit('get_models');

      timerRef.current = setInterval(() => {
        if (socket.connected) {
          socket.emit('ping', {});
        }
      }, 25000);
    });

    socket.on('disconnect', (reason) => {
      logWsMessage('received', 'disconnect', { reason });
      setWsStatus("disconnected");

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      if (reason !== 'io client disconnect') {
        const delay = Math.min(1000 * 2 ** retryRef.current, 15000);
        retryRef.current += 1;
        setTimeout(() => {
          if (useWebSocket && socketRef.current) {
            socket.connect();
          }
        }, delay);
      }
    });

    socket.on('connect_error', (error) => {
      logWsMessage('received', 'connect_error', { error: error.message });
      setWsStatus("disconnected");
    });

    socket.on('connection_response', (data) => {
      logWsMessage('received', 'connection_response', data);
    });

    socket.on('chat_response', (data) => {
      logWsMessage('received', 'chat_response', data);
      setIsLoading(false);
      const botMessage = {
        id: Date.now(),
        text: data.response,
        isUser: false,
        timestamp: new Date(),
        model: data.model_used,
        modelInfo: data.model_info,
        isLoading: false
      };
      setMessages(prev => {
        const withoutLoading = prev.filter(msg => !msg.isLoading);
        return [...withoutLoading, botMessage];
      });
    });

    socket.on('error', (data) => {
      logWsMessage('received', 'error', data);
      setIsLoading(false);
      const errorMessage = {
        id: Date.now(),
        text: `Error: ${data.error || data.message}`,
        isUser: false,
        timestamp: new Date(),
        isError: true,
        isLoading: false
      };
      setMessages(prev => {
        const withoutLoading = prev.filter(msg => !msg.isLoading);
        return [...withoutLoading, errorMessage];
      });
    });

    socket.on('models_list', (data) => {
      logWsMessage('received', 'models_list', data);
      setModels(data.models);
      if (!selectedModel && Object.keys(data.models).length > 0) {
        setSelectedModel(Object.keys(data.models)[0]);
      }
    });

    socket.on('context_data', (data) => {
      logWsMessage('received', 'context_data', data);
      setContextHistory(data.history);
    });

    socket.on('conversation_cleared', (data) => {
      logWsMessage('received', 'conversation_cleared', data);
      setContextHistory([]);
      setMessages([]);
    });

    socket.on('recommendation_response', (data) => {
      logWsMessage('received', 'recommendation_response', data);
      setRecommendation(data);
      if (data.recommended_model) {
        setSelectedModel(data.recommended_model);
      }
    });

    socket.on('pong', (data) => {
      logWsMessage('received', 'pong', data);
    });

    socket.connect();
  };

  const disconnect = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (socketRef.current) {
      logWsMessage('sent', 'disconnect', { manual: true });
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setWsStatus("disconnected");
    retryRef.current = 0;
  };

  const sendSocketMessage = (event, payload = {}) => {
    if (socketRef.current && socketRef.current.connected) {
      try {
        socketRef.current.emit(event, payload);
        logWsMessage('sent', event, payload);
        return true;
      } catch (error) {
        logWsMessage('sent', 'error', { error: error.message, event, payload });
        return false;
      }
    } else {
      logWsMessage('sent', 'failed', { reason: 'not_connected', event, payload });
      return false;
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const sendMessage = async () => {
    if (!inputMessage.trim()) return;

    const userMessage = {
      id: Date.now(),
      text: inputMessage,
      isUser: true,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = inputMessage;
    setInputMessage('');
    setIsLoading(true);

    const loadingMessage = {
      id: Date.now() + 1,
      text: '',
      isUser: false,
      timestamp: new Date(),
      model: selectedModel,
      isLoading: true
    };

    setMessages(prev => [...prev, loadingMessage]);

    if (wsStatus === "connected") {
      const success = sendSocketMessage('chat_message', {
        message: currentInput,
        model: selectedModel || 'default-model'
      });

      if (!success) {
        setIsLoading(false);
        setMessages(prev => prev.filter(msg => !msg.isLoading));
      }

    } else {
      const errorMessage = {
        id: Date.now(),
        text: 'WebSocket not connected. Please connect first.',
        isUser: false,
        timestamp: new Date(),
        isError: true,
        isLoading: false
      };
      setMessages(prev => {
        const withoutLoading = prev.filter(msg => !msg.isLoading);
        return [...withoutLoading, errorMessage];
      });
      setIsLoading(false);
    }
  };

  const getConnectionStatusColor = () => {
    switch (wsStatus) {
      case 'connected': return '#4CAF50';
      case 'connecting': return '#FF9800';
      case 'disconnected': return '#f44336';
      default: return '#9E9E9E';
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ flex: showWsLog ? 2 : 1, display: 'flex', flexDirection: 'column' }}>
        <header className="chat-header">
          <h1>Multi-Model LLM Chat Interface</h1>
          
          <div className="model-selection">
            <div className="model-dropdown">
              <label htmlFor="model-select">Select Model:</label>
              <select
                id="model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {Object.entries(models).map(([key, model]) => (
                  <option key={key} value={key}>
                    {model.display_name}
                  </option>
                ))}
              </select>
              <button
                className="recommend-btn"
                onClick={getRecommendation}
                disabled={isLoading}
              >
                🤖 Get Recommendation
              </button>
            </div>
            
            {selectedModel && models[selectedModel] && (
              <div className="model-info">
                {models[selectedModel].description}
              </div>
            )}
            
            {recommendation && (
              <div className="recommendation">
                <strong>🎯 Recommended:</strong> {recommendation.model_info.display_name}<br/>
                <strong>Reason:</strong> {recommendation.reason}
              </div>
            )}
          </div>
        </header>
        <div className="messages-container">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`message ${message.isUser ? 'user-message' : 'bot-message'} ${message.isError ? 'error-message' : ''}`}
            >
              {message.isUser ? (
                <div className="message-content">{message.text}</div>
              ) : (
                <div className="message-content">
                  {message.isLoading ? (
                    <div className="loading">AI is thinking...</div>
                  ) : (
                    <ReactMarkdown
                      components={{
                        code({ node, inline, className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '');
                          const language = match ? match[1] : '';
                          const codeContent = String(children).replace(/\n$/, '');

                          if (!inline && language) {
                            return (
                              <div className="code-block-wrapper relative">
                                <button
                                  style={{
                                    position: "absolute",
                                    top: "8px",
                                    right: "8px",
                                    padding: "4px 8px",
                                    fontSize: "12px",
                                    backgroundColor: "#374151", // gray-700
                                    color: "white",
                                    borderRadius: "4px",
                                    border: "none",
                                    cursor: "pointer"
                                  }}
                                  onClick={() => navigator.clipboard.writeText(codeContent)}
                                  onMouseOver={(e) => (e.target.style.backgroundColor = "#4b5563")} // gray-600
                                  onMouseOut={(e) => (e.target.style.backgroundColor = "#374151")} // back to gray-700
                                >
                                  Copy
                                </button>


                                <CodeBlock language={language} value={codeContent} {...props} />
                              </div>
                            );
                          }

                          return (
                            <code className={`inline-code ${className || ''}`} {...props}>
                              {children}
                            </code>
                          );
                        }
                      }}
                    >
                      {message.text}
                    </ReactMarkdown>



                  )}
                  {!message.isLoading && message.model && (
                    <div className="model-badge">
                      {models[message.model]?.display_name || message.model}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div style={{
          padding: '20px',
          borderTop: '1px solid #ddd',
          backgroundColor: '#f8f9fa',
          display: 'flex',
          gap: '10px'
        }}>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type your message here..."
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            disabled={isLoading}
            style={{
              flex: 1,
              padding: '12px',
              border: '1px solid #ddd',
              borderRadius: '8px',
              fontSize: '16px'
            }}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || wsStatus !== 'connected'}
            style={{
              padding: '12px 24px',
              border: 'none',
              borderRadius: '8px',
              backgroundColor: wsStatus === 'connected' ? '#007bff' : '#6c757d',
              color: 'white',
              cursor: (isLoading || wsStatus !== 'connected') ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              opacity: isLoading || wsStatus !== 'connected' ? 0.6 : 1
            }}
          >
            Send via WebSocket
          </button>
        </div>
      </div>

      {showWsLog && (
        <div style={{
          width: '400px',
          borderLeft: '1px solid #ddd',
          backgroundColor: '#1a1a1a',
          color: '#f0f0f0',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{
            padding: '15px',
            borderBottom: '1px solid #333',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h3 style={{ margin: 0, fontSize: '16px' }}>WebSocket Messages</h3>
            <button
              onClick={clearWsLog}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                border: '1px solid #666',
                backgroundColor: 'transparent',
                color: '#f0f0f0',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          </div>

          <div
            ref={wsLogRef}
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '10px',
              fontSize: '12px',
              fontFamily: 'monospace'
            }}
          >
            {wsMessages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  marginBottom: '12px',
                  padding: '8px',
                  backgroundColor: msg.direction === 'sent' ? '#1e3a8a20' : '#16537e20',
                  border: `1px solid ${msg.direction === 'sent' ? '#1e3a8a' : '#16537e'}`,
                  borderRadius: '4px'
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '4px',
                  color: msg.direction === 'sent' ? '#60a5fa' : '#38bdf8'
                }}>
                  <span>{msg.direction === 'sent' ? '📤 SENT' : '📥 RECEIVED'}</span>
                  <span>{msg.timestamp}</span>
                </div>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                  Event: {msg.event}
                </div>
                <pre style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  fontSize: '11px',
                  color: '#d1d5db'
                }}>
                  {msg.data}
                </pre>
              </div>
            ))}
            {wsMessages.length === 0 && (
              <div style={{
                textAlign: 'center',
                color: '#666',
                fontStyle: 'italic',
                marginTop: '50px'
              }}>
                No WebSocket messages yet...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default WschatApp;
