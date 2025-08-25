import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import axios from 'axios';
import './Ws.css';


function Ws() {
    const [models, setModels] = useState({});
    const [selectedModel, setSelectedModel] = useState('');
    const [messages, setMessages] = useState([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [recommendation, setRecommendation] = useState(null);
    const [wsStatus, setWsStatus] = useState("disconnected");
    const messagesEndRef = useRef(null);
    const [wsMessages, setWsMessages] = useState([]);
    const socketRef = useRef(null);
    const retryRef = useRef(0);
    const timerRef = useRef(null);
    const wsLogRef = useRef(null);
    const [useWebSocket, setUseWebSocket] = useState(true);
    const [contextHistory, setContextHistory] = useState([]);


    const API_BASE_URL = 'https://multimodel-dfazgpgugneff4cr.eastus-01.azurewebsites.net/api';

    const SOCKET_URL = 'https://multimodel-dfazgpgugneff4cr.eastus-01.azurewebsites.net';



    // web Socket connection status

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

    //   const fetchModels = async () => {
    //     try {
    //       const response = await fetch(`${API_BASE_URL}/models`);
    //       const data = await response.json();
    //       setModels(data.models);
    //       const firstModel = Object.keys(data.models)[0];
    //       if (!selectedModel) {
    //         setSelectedModel(firstModel);
    //       }
    //     } catch (error) {
    //       console.error('Error fetching models:', error);
    //       if (useWebSocket && socketRef.current && socketRef.current.connected) {
    //         sendSocketMessage('get_models');
    //       }
    //     }
    //   };





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



    const sendMessageWs = async () => {
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



    useEffect(() => {
        fetchModels();
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const fetchModels = async () => {
        try {
            const response = await axios.get(`${API_BASE_URL}/models`);
            setModels(response.data.models);
            const firstModel = Object.keys(response.data.models)[0];
            setSelectedModel(firstModel);
        } catch (error) {
            console.error('Error fetching models:', error);
        }
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

    const sendMessage = async (isStreaming = true) => {
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

        const botMessage = {
            id: Date.now() + 1,
            text: '',
            isUser: false,
            timestamp: new Date(),
            model: selectedModel,
            isLoading: true
        };

        setMessages(prev => [...prev, botMessage]);

        try {
            if (isStreaming) {
                await handleStreamingResponse(currentInput, botMessage.id);
            } else {
                await handleSimpleResponse(currentInput, botMessage.id);
            }
        } catch (error) {
            updateBotMessage(botMessage.id, `Error: ${error.message}`, false, true);
        } finally {
            setIsLoading(false);
        }
    };

    const handleStreamingResponse = async (message, messageId) => {
        try {
            const response = await fetch(`${API_BASE_URL}/chat/stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    model: selectedModel
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.content) {
                                accumulatedText += data.content;
                                updateBotMessage(messageId, accumulatedText, false, false);
                            } else if (data.done) {
                                updateBotMessage(messageId, accumulatedText, false, false);
                                return;
                            } else if (data.error) {
                                updateBotMessage(messageId, `Error: ${data.error}`, false, true);
                                return;
                            }
                        } catch (e) {
                            // Ignore JSON parse errors for incomplete chunks
                        }
                    }
                }
            }
        } catch (error) {
            updateBotMessage(messageId, `Error: ${error.message}`, false, true);
        }
    };

    const handleSimpleResponse = async (message, messageId) => {
        try {
            const response = await axios.post(`${API_BASE_URL}/chat`, {
                message: message,
                model: selectedModel
            });

            updateBotMessage(messageId, response.data.response, false, false);
        } catch (error) {
            updateBotMessage(messageId, `Error: ${error.message}`, false, true);
        }
    };

    const updateBotMessage = (messageId, text, isLoading, isError) => {
        setMessages(prev => prev.map(msg =>
            msg.id === messageId
                ? { ...msg, text, isLoading, isError }
                : msg
        ));
    };

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

    return (
        <div className="app">
            <div className="chat-container">
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
                                <strong>🎯 Recommended:</strong> {recommendation.model_info.display_name}<br />
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

                <div className="input-container">
                    <input
                        type="text"
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        placeholder="Type your message here..."
                        onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                        disabled={isLoading}
                    />
                    <button
                        onClick={() => sendMessage(true)}
                        disabled={isLoading}
                        className="send-btn"
                    >
                        Send (Stream)
                    </button>
                    <button
                        onClick={() => sendMessage(false)}
                        disabled={isLoading}
                        className="send-btn simple-btn"
                    >
                        Send (Simple)
                    </button>

                    <button
                        onClick={sendMessageWs}
                        disabled={isLoading}
                        className="send-btn"
                    >
                        Send (WebSocket)
                    </button>


                </div>
            </div>
        </div>
    );
}

export default Ws;