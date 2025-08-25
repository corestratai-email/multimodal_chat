import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import axios from 'axios';
import './Ws.css';

// Assuming Tailwind CSS is configured and available in the environment.
// The CSS file and syntax highlighter libraries were removed to fix compilation issues.

const API_BASE_URL = 'http://localhost:5001/api';

const Ws = () => {
  const [models, setModels] = useState({});
  const [selectedModel, setSelectedModel] = useState('');
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [recommendation, setRecommendation] = useState(null);
  const messagesEndRef = useRef(null);
  const wsRef = useRef(null); // Ref to hold the WebSocket instance

  useEffect(() => {
    fetchModels();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Cleanup WebSocket on component unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

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
      // Use a custom message box or alert to the user. Since alerts are not allowed,
      // we'll log to the console as a placeholder.
      console.log('Please enter a message first to get a model recommendation.');
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

  const sendMessage = async (sendType) => {
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
      if (sendType === 'stream') {
        await handleStreamingResponse(currentInput, botMessage.id);
      } else if (sendType === 'simple') {
        await handleSimpleResponse(currentInput, botMessage.id);
      } else if (sendType === 'websocket') {
        await handleWebSocketResponse(currentInput, botMessage.id);
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

  const handleWebSocketResponse = async (message, messageId) => {
    try {
      // Create a WebSocket connection
      // Replace 'http' with 'ws' or 'https' with 'wss'
      const wsUrl = API_BASE_URL.replace('http', 'ws') + '/chat/ws';
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('WebSocket connection opened.');
        // Send the message once the connection is open
        wsRef.current.send(JSON.stringify({
          message: message,
          model: selectedModel
        }));
      };

      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'chunk') {
          // Append the new chunk to the current bot message
          setMessages(prev => prev.map(msg => 
            msg.id === messageId
              ? { ...msg, text: msg.text + data.content, isLoading: false }
              : msg
          ));
        } else if (data.type === 'complete') {
          // Mark the message as no longer loading
          updateBotMessage(messageId, messages.find(m => m.id === messageId).text, false, false);
        } else if (data.type === 'error') {
          updateBotMessage(messageId, `Error: ${data.content}`, false, true);
        }
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket connection closed.');
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateBotMessage(messageId, `WebSocket Error`, false, true);
      };

    } catch (error) {
      updateBotMessage(messageId, `Error establishing WebSocket connection: ${error.message}`, false, true);
    }
  };

  const updateBotMessage = (messageId, text, isLoading, isError) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId 
        ? { ...msg, text, isLoading, isError }
        : msg
    ));
  };

  // A simple CodeBlock component since react-syntax-highlighter is not available.
  const CodeBlock = ({ language, value }) => {
    return (
      <pre className="p-4 my-4 bg-gray-800 text-white rounded-lg overflow-x-auto text-sm">
        <code className={`language-${language}`}>{value}</code>
      </pre>
    );
  };

  const MemoizedReactMarkdown = React.memo(ReactMarkdown);

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow p-4 flex flex-col sm:flex-row items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800 mb-2 sm:mb-0">Multi-Model LLM Chat Interface</h1>
          
          <div className="flex items-center space-x-2">
            <label htmlFor="model-select" className="text-gray-700 font-medium">Select Model:</label>
            <select
              id="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="p-2 border rounded-md"
            >
              {Object.entries(models).map(([key, model]) => (
                <option key={key} value={key}>
                  {model.display_name}
                </option>
              ))}
            </select>
            <button
              className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 disabled:bg-blue-300 transition-colors duration-200"
              onClick={getRecommendation}
              disabled={isLoading}
            >
              🤖 Get Recommendation
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`p-4 rounded-lg shadow-md max-w-lg ${message.isUser ? 'bg-blue-500 text-white ml-auto' : 'bg-white text-gray-800 mr-auto'} ${message.isError ? 'bg-red-200 text-red-800' : ''}`}
            >
              <div className="prose prose-sm max-w-none">
                {message.isUser ? (
                  <p>{message.text}</p>
                ) : (
                  <div>
                    {message.isLoading ? (
                      <div className="loading text-gray-500 italic">AI is thinking...</div>
                    ) : (
                      <MemoizedReactMarkdown
                        components={{
                          code({ node, inline, className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '');
                            const language = match ? match[1] : '';
                            
                            if (!inline) {
                              return (
                                <CodeBlock
                                  language={language}
                                  value={String(children).replace(/\n$/, '')}
                                  {...props}
                                />
                              );
                            }
                            
                            return (
                              <code className={`inline-code bg-gray-200 text-gray-800 px-1 rounded ${className || ''}`} {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {message.text}
                      </MemoizedReactMarkdown>
                    )}
                    {!message.isLoading && message.model && (
                      <div className="mt-2 text-xs text-gray-400">
                        {models[message.model]?.display_name || message.model}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-gray-200 flex items-center space-x-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type your message here..."
            onKeyPress={(e) => e.key === 'Enter' && sendMessage('simple')} // Default to simple send on Enter
            disabled={isLoading}
            className="flex-1 p-3 rounded-full border border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => sendMessage('stream')}
            disabled={isLoading}
            className="bg-green-500 text-white px-4 py-3 rounded-full hover:bg-green-600 disabled:bg-green-300 transition-colors duration-200"
          >
            Stream
          </button>
          <button
            onClick={() => sendMessage('simple')}
            disabled={isLoading}
            className="bg-purple-500 text-white px-4 py-3 rounded-full hover:bg-purple-600 disabled:bg-purple-300 transition-colors duration-200"
          >
            Simple
          </button>
          <button
            onClick={() => sendMessage('websocket')}
            disabled={isLoading}
            className="bg-red-500 text-white px-4 py-3 rounded-full hover:bg-red-600 disabled:bg-red-300 transition-colors duration-200"
          >
            WebSocket
          </button>
        </div>
      </div>
    </div>
  );
}

export default Ws;