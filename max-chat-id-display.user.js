// ==UserScript==
// @name         MAX - Показать ID чатов и контактов
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Показывает ID чатов и контактов рядом с их названиями в MAX. Добавляет кнопку копирования ID в контекстное меню. Добавляет кнопку для копирования ID профиля на странице редактирования.
// @author       You
// @match        https://web.max.ru/*
// @match        http://web.max.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Стили для отображения ID
    const style = document.createElement('style');
    style.textContent = `
        .chat-id-display {
            font-size: 11px;
            color: #888;
            margin-left: 8px;
            font-weight: normal;
            opacity: 0.7;
            font-family: monospace;
        }
    `;
    document.head.appendChild(style);

    // Хранилище для ID чатов: title -> id
    const chatIdMap = new Map();
    // Хранилище для ID контактов: name/phone -> id (несколько ключей для одного контакта)
    const contactIdMap = new Map();
    // Хранилище для всех контактов из WebSocket: id -> contact data
    const contactsDataMap = new Map();
    // Хранилище для сопоставления элементов DOM с ID
    const elementIdMap = new WeakMap();
    // Хранилище для текущего выбранного элемента (для контекстного меню)
    let currentSelectedElement = null;
    // ID текущего пользователя (профиля)
    let profileUserId = null;

    // Перехватываем навигацию для получения ID из URL
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
        originalPushState.apply(history, args);
        extractIdFromUrl();
    };

    history.replaceState = function(...args) {
        originalReplaceState.apply(history, args);
        extractIdFromUrl();
    };

    window.addEventListener('popstate', extractIdFromUrl);

    function extractIdFromUrl() {
        const url = window.location.href;
        // Пытаемся найти ID в URL
        const patterns = [
            /\/chat\/(\d+)/i,
            /\/chat-(\d+)/i,
            /chatId=(\d+)/i,
            /id=(\d+)/i,
            /\/(\d+)(?:\?|$)/i
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match && match[1]) {
                // Сохраняем последний открытый чат
                window.lastChatId = match[1];
                return match[1];
            }
        }
        return null;
    }

    // Функция для получения названия чата из элемента
    function getChatTitle(chatElement) {
        const titleElement = chatElement.querySelector('.title .text') || 
                            chatElement.querySelector('h3.title .text') ||
                            chatElement.querySelector('.title') ||
                            chatElement.querySelector('h3.title');
        if (titleElement) {
            return titleElement.textContent.trim();
        }
        return null;
    }

    // Функция для извлечения ID чата из карты по названию
    function extractChatId(chatElement) {
        // Сначала проверяем сохраненный ID для элемента
        if (elementIdMap.has(chatElement)) {
            return elementIdMap.get(chatElement);
        }

        // Пытаемся найти по названию
        const title = getChatTitle(chatElement);
        if (title && chatIdMap.has(title)) {
            const id = chatIdMap.get(title);
            elementIdMap.set(chatElement, id);
            return id;
        }

        return null;
    }

    // Функция для добавления ID к чату
    function addChatId(chatElement) {
        const titleElement = chatElement.querySelector('.title') || chatElement.querySelector('h3.title');
        if (!titleElement) return;

        // Удаляем старый ID, если есть
        const oldId = titleElement.querySelector('.chat-id-display');
        if (oldId) {
            oldId.remove();
        }

        const chatId = extractChatId(chatElement);

        if (chatId) {
            const idSpan = document.createElement('span');
            idSpan.className = 'chat-id-display';
            idSpan.textContent = `[${chatId}]`;
            titleElement.appendChild(idSpan);
        }
    }

    // Функция для получения названия контакта (все возможные варианты)
    function getContactName(contactElement) {
        const nameElement = contactElement.querySelector('.name .text') ||
                           contactElement.querySelector('.title .text') ||
                           contactElement.querySelector('.name') ||
                           contactElement.querySelector('.title');
        if (nameElement) {
            return nameElement.textContent.trim();
        }
        return null;
    }

    // Функция для получения всех возможных идентификаторов контакта
    function getContactIdentifiers(contactElement) {
        const identifiers = [];
        const name = getContactName(contactElement);
        if (name) {
            identifiers.push(name);
            // Также добавляем варианты имени
            const parts = name.split(' ');
            if (parts.length > 1) {
                identifiers.push(parts[0]); // Имя
                identifiers.push(parts.join(' ')); // Полное имя
            }
        }
        return identifiers;
    }

    // Функция для получения ID контакта
    function extractContactId(contactElement) {
        if (elementIdMap.has(contactElement)) {
            return elementIdMap.get(contactElement);
        }

        const identifiers = getContactIdentifiers(contactElement);
        for (const identifier of identifiers) {
            if (contactIdMap.has(identifier)) {
                const id = contactIdMap.get(identifier);
                elementIdMap.set(contactElement, id);
                return id;
            }
        }

        return null;
    }

    // Функция для добавления ID к контакту
    function addContactId(contactElement) {
        const titleElement = contactElement.querySelector('.title') || 
                            contactElement.querySelector('.name') ||
                            contactElement.querySelector('h3.title');
        if (!titleElement) return;

        const oldId = titleElement.querySelector('.chat-id-display');
        if (oldId) {
            oldId.remove();
        }

        const contactId = extractContactId(contactElement);
        if (contactId) {
            const idSpan = document.createElement('span');
            idSpan.className = 'chat-id-display';
            idSpan.textContent = `[${contactId}]`;
            titleElement.appendChild(idSpan);
        }
    }

    // Функция для обработки всех чатов на странице
    function processChats() {
        // Ищем элементы чатов по классу
        const chatSelectors = [
            '.item.svelte-rg2upy',
            '[class*="item"][class*="chat"]',
            '.wrapper.wrapper--withActions'
        ];

        let chats = [];
        for (const selector of chatSelectors) {
            chats = document.querySelectorAll(selector);
            if (chats.length > 0) break;
        }

        chats.forEach(chat => {
            // Проверяем, не является ли это контактом (контакты обрабатываются отдельно)
            const contactId = extractContactId(chat);
            if (!contactId) {
                addChatId(chat);
            }
        });
    }

    // Функция для обработки контактов
    function processContacts() {
        // Обрабатываем все элементы, которые могут быть контактами
        // Контакты могут иметь ту же структуру, что и чаты
        const allItems = document.querySelectorAll('.item.svelte-rg2upy, .wrapper.wrapper--withActions, [class*="item"]');
        
        allItems.forEach(item => {
            // Сначала проверяем, не является ли это чатом
            const chatId = extractChatId(item);
            if (!chatId) {
                // Если это не чат, проверяем как контакт
                const contactId = extractContactId(item);
                if (contactId) {
                    addContactId(item);
                }
            }
        });
        
        // Также обрабатываем явные элементы контактов
        const contactSelectors = [
            '[class*="contact"]:not(.item.svelte-rg2upy)',
            '[class*="user"]:not(.item.svelte-rg2upy)'
        ];

        contactSelectors.forEach(selector => {
            try {
                const contacts = document.querySelectorAll(selector);
                contacts.forEach(contact => {
                    addContactId(contact);
                });
            } catch (e) {
                // Игнорируем ошибки селекторов
            }
        });
    }

    // Функция для обработки страницы профиля
    function processProfilePage() {
        if (!profileUserId) return;
        
        // Проверяем, не добавлена ли уже кнопка
        if (document.querySelector('.profile-copy-id-button')) return;
        
        // Ищем bottomGroup в навигации (где находятся кнопки "Контакты", "Звонки", "Профиль")
        let buttonContainer = null;
        
        // Ищем элемент bottomGroup
        const bottomGroup = document.querySelector('.bottomGroup.svelte-174ybgs') ||
                           document.querySelector('[class*="bottomGroup"]') ||
                           document.querySelector('.bottomGroup');
        
        if (bottomGroup) {
            buttonContainer = bottomGroup;
        }
        
        if (buttonContainer) {
            // Создаем кнопку в стиле других кнопок в bottomGroup (как "Профиль", "Контакты", "Звонки")
            const button = document.createElement('button');
            button.className = 'button svelte-xwrwgf profile-copy-id-button';
            
            // Иконка
            const iconSpan = document.createElement('span');
            iconSpan.className = 'icon svelte-xwrwgf';
            iconSpan.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            `;
            
            // Текст кнопки
            const titleSpan = document.createElement('span');
            titleSpan.className = 'title svelte-xwrwgf';
            titleSpan.textContent = 'Скопировать ID';
            
            button.appendChild(iconSpan);
            button.appendChild(titleSpan);
            
            // Обработчик клика
            button.addEventListener('click', () => {
                copyToClipboard(String(profileUserId));
                const originalText = titleSpan.textContent;
                titleSpan.textContent = 'ID скопирован!';
                setTimeout(() => {
                    titleSpan.textContent = originalText;
                }, 2000);
            });
            
            buttonContainer.appendChild(button);
            console.log('Кнопка копирования ID профиля добавлена в bottomGroup');
        }
    }

    // Обработка существующих чатов и контактов
    processChats();
    processContacts();
    processProfilePage();
    
    // Периодическая обработка контактов и профиля (на случай задержки загрузки данных)
    setInterval(() => {
        if (contactIdMap.size > 0) {
            processContacts();
        }
        if (profileUserId) {
            processProfilePage();
        }
    }, 2000);

    // Наблюдатель за изменениями DOM (для динамически добавляемых чатов)
    const observer = new MutationObserver((mutations) => {
        let shouldProcess = false;
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        if (node.classList?.contains('item') || 
                            node.querySelector?.('.item') ||
                            node.classList?.contains('wrapper') ||
                            node.classList?.contains('contact') ||
                            node.querySelector?.('[class*="contact"]')) {
                            shouldProcess = true;
                        }
                    }
                });
            }
        });
        if (shouldProcess) {
            setTimeout(() => {
                processChats();
                processContacts();
                // Проверяем страницу профиля при изменениях DOM
                if (window.location.href.includes('/profile') || 
                    window.location.href.includes('/settings') || 
                    window.location.href.includes('/edit') ||
                    document.querySelector('[class*="profile"]') ||
                    document.querySelector('[class*="settings"]')) {
                    processProfilePage();
                }
            }, 100);
        }
        
        // Также периодически проверяем контакты и профиль (на случай, если они загрузились позже)
        if (contactIdMap.size > 0) {
            setTimeout(() => {
                processContacts();
            }, 500);
        }
        if (profileUserId) {
            setTimeout(() => {
                processProfilePage();
            }, 500);
        }
    });

    // Начинаем наблюдение
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Также обрабатываем при изменении URL (для SPA)
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            setTimeout(() => {
                processChats();
                // Проверяем, не открыта ли страница профиля
                if (url.includes('/profile') || url.includes('/settings') || url.includes('/edit')) {
                    setTimeout(processProfilePage, 500);
                }
            }, 500);
        }
    }).observe(document, { subtree: true, childList: true });

    // Пытаемся получить ID из состояния Svelte
    // Это может работать, если приложение хранит состояние в window
    setTimeout(() => {
        // Проверяем различные возможные места хранения состояния
        if (window.__SVELTEKIT__ || window.__svelte || window.app) {
            // Пытаемся найти состояние чатов
            const checkSvelteState = () => {
                try {
                    // Ищем в возможных местах хранения состояния
                    const possibleStates = [
                        window.__SVELTEKIT__,
                        window.__svelte,
                        window.app,
                        document.querySelector('#app')?.__svelte
                    ];

                    for (const state of possibleStates) {
                        if (state && typeof state === 'object') {
                            // Пытаемся найти данные чатов
                            const chatData = findChatDataInObject(state);
                            if (chatData) {
                                applyChatIds(chatData);
                                return true;
                            }
                        }
                    }
                } catch (e) {
                    console.log('Не удалось получить состояние Svelte:', e);
                }
                return false;
            };

            const findChatDataInObject = (obj, depth = 0) => {
                if (depth > 5) return null; // Ограничиваем глубину поиска
                if (!obj || typeof obj !== 'object') return null;

                // Проверяем ключи, которые могут содержать данные чатов
                const chatKeys = ['chats', 'chatList', 'items', 'data', 'state'];
                for (const key of chatKeys) {
                    if (obj[key] && Array.isArray(obj[key])) {
                        return obj[key];
                    }
                }

                // Рекурсивно ищем в дочерних объектах
                for (const key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        const result = findChatDataInObject(obj[key], depth + 1);
                        if (result) return result;
                    }
                }
                return null;
            };

            const applyChatIds = (chatData) => {
                chatData.forEach((chat, index) => {
                    if (chat && chat.id) {
                        const chatElements = document.querySelectorAll('.item.svelte-rg2upy');
                        if (chatElements[index]) {
                            const titleElement = chatElements[index].querySelector('.title');
                            if (titleElement && !titleElement.querySelector('.chat-id-display')) {
                                const idSpan = document.createElement('span');
                                idSpan.className = 'chat-id-display';
                                idSpan.textContent = `[${chat.id}]`;
                                titleElement.appendChild(idSpan);
                            }
                        }
                    }
                });
            };

            checkSvelteState();
        }
    }, 2000);

    // Перехватываем fetch запросы для получения ID чатов из API
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        return originalFetch.apply(this, args).then(response => {
            const url = args[0];
            if (typeof url === 'string' && (url.includes('/chat') || url.includes('/api'))) {
                // Пытаемся найти ID в URL запроса
                const idMatch = url.match(/chat[\/\-]?(\d+)/i) || url.match(/\/(\d+)(?:\?|$)/);
                if (idMatch && idMatch[1]) {
                    const chatId = idMatch[1];
                    // Обновляем ID для всех чатов
                    setTimeout(() => {
                        const chatElements = document.querySelectorAll('.item.svelte-rg2upy');
                        chatElements.forEach((el, index) => {
                            const button = el.querySelector('button.cell') || el.querySelector('button');
                            if (button && !chatIdMap.has(button)) {
                                // Пытаемся сопоставить по позиции или другим признакам
                                chatIdMap.set(button, chatId);
                            }
                        });
                        processChats();
                    }, 100);
                }

                // Пытаемся получить ID из ответа
                response.clone().json().then(data => {
                    if (data && typeof data === 'object') {
                        const chatData = findChatDataInResponse(data);
                        if (chatData && Array.isArray(chatData)) {
                            chatData.forEach((chat, index) => {
                                if (chat && (chat.id || chat.chatId || chat.chat_id)) {
                                    const chatId = chat.id || chat.chatId || chat.chat_id;
                                    const chatElements = document.querySelectorAll('.item.svelte-rg2upy');
                                    if (chatElements[index]) {
                                        const button = chatElements[index].querySelector('button.cell') || 
                                                     chatElements[index].querySelector('button');
                                        if (button) {
                                            chatIdMap.set(button, String(chatId));
                                        }
                                    }
                                }
                            });
                            processChats();
                        }
                    }
                }).catch(() => {}); // Игнорируем ошибки парсинга
            }
            return response;
        });
    };

    function findChatDataInResponse(obj, depth = 0) {
        if (depth > 5) return null;
        if (!obj || typeof obj !== 'object') return null;

        // Проверяем прямые массивы с чатами
        if (Array.isArray(obj)) {
            if (obj.length > 0 && obj[0] && (obj[0].id || obj[0].chatId || obj[0].chat_id)) {
                return obj;
            }
        }

        // Проверяем ключи, которые могут содержать данные чатов
        const chatKeys = ['chats', 'chatList', 'items', 'data', 'results', 'list'];
        for (const key of chatKeys) {
            if (obj[key] && Array.isArray(obj[key])) {
                return obj[key];
            }
        }

        // Рекурсивно ищем в дочерних объектах
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const result = findChatDataInResponse(obj[key], depth + 1);
                if (result) return result;
            }
        }
        return null;
    }

    // Перехватываем WebSocket соединение
    function interceptWebSocket() {
        const OriginalWebSocket = window.WebSocket;
        
        window.WebSocket = function(...args) {
            const ws = new OriginalWebSocket(...args);
            
            // Создаем обертку для обработки сообщений
            const processMessage = function(event) {
                try {
                    // Пытаемся парсить JSON сообщение
                    const data = JSON.parse(event.data);
                    
                    // Обрабатываем чаты
                    if (data.payload && data.payload.chats && Array.isArray(data.payload.chats)) {
                        let updated = false;
                        data.payload.chats.forEach(chat => {
                            const chatId = chat.id !== undefined ? chat.id : (chat.cid !== undefined ? chat.cid : null);
                            
                            if (chatId !== null && chat.title) {
                                const oldId = chatIdMap.get(chat.title);
                                if (oldId !== chatId) {
                                    chatIdMap.set(chat.title, chatId);
                                    console.log(`Найден чат: "${chat.title}" -> ID: ${chatId}`);
                                    updated = true;
                                }
                            }
                        });
                        
                        if (updated) {
                            setTimeout(processChats, 100);
                        }
                    }
                    
                    // Обрабатываем профиль пользователя
                    if (data.payload && data.payload.profile) {
                        const userId = data.payload.profile.id || 
                                      data.payload.profile.contact?.id;
                        
                        if (userId && profileUserId !== userId) {
                            profileUserId = userId;
                            console.log(`Найден ID профиля: ${userId}`);
                            // Обновляем отображение ID профиля
                            setTimeout(() => {
                                processProfilePage();
                            }, 500);
                        }
                    }
                    
                    // Обрабатываем контакты
                    if (data.payload && data.payload.contacts && Array.isArray(data.payload.contacts)) {
                        let updated = false;
                        data.payload.contacts.forEach(contact => {
                            if (contact.id !== undefined) {
                                // Сохраняем полные данные контакта
                                contactsDataMap.set(contact.id, contact);
                                
                                // Создаем несколько ключей для одного контакта
                                const identifiers = [];
                                
                                // Имя из массива names
                                if (contact.names && contact.names.length > 0) {
                                    contact.names.forEach(nameObj => {
                                        if (nameObj.name) identifiers.push(nameObj.name);
                                        if (nameObj.firstName) {
                                            identifiers.push(nameObj.firstName);
                                            if (nameObj.lastName) {
                                                identifiers.push(`${nameObj.firstName} ${nameObj.lastName}`);
                                            }
                                        }
                                    });
                                }
                                
                                // Телефон
                                if (contact.phone) {
                                    identifiers.push(String(contact.phone));
                                }
                                
                                // Сохраняем ID по всем идентификаторам
                                identifiers.forEach(identifier => {
                                    if (identifier) {
                                        const oldId = contactIdMap.get(identifier);
                                        if (oldId !== contact.id) {
                                            contactIdMap.set(identifier, contact.id);
                                            console.log(`Найден контакт: "${identifier}" -> ID: ${contact.id}`);
                                            updated = true;
                                        }
                                    }
                                });
                            }
                        });
                        
                        if (updated) {
                            setTimeout(() => {
                                processContacts();
                                processChats();
                            }, 100);
                        }
                    }
                } catch (e) {
                    // Игнорируем ошибки парсинга (не JSON или другая структура)
                }
            };
            
            // Перехватываем addEventListener
            const originalAddEventListener = ws.addEventListener.bind(ws);
            ws.addEventListener = function(type, listener, options) {
                if (type === 'message') {
                    // Добавляем наш обработчик
                    originalAddEventListener('message', processMessage);
                    // И оригинальный обработчик
                    return originalAddEventListener(type, listener, options);
                }
                return originalAddEventListener(type, listener, options);
            };
            
            // Перехватываем onmessage
            let originalOnMessage = null;
            Object.defineProperty(ws, 'onmessage', {
                get: function() {
                    return originalOnMessage;
                },
                set: function(handler) {
                    originalOnMessage = handler;
                    // Добавляем наш обработчик
                    originalAddEventListener('message', processMessage);
                    if (handler) {
                        originalAddEventListener('message', handler);
                    }
                }
            });
            
            return ws;
        };
        
        // Сохраняем оригинальный WebSocket
        window.WebSocket.prototype = OriginalWebSocket.prototype;
        Object.setPrototypeOf(window.WebSocket, OriginalWebSocket);
    }

    // Запускаем перехват WebSocket
    interceptWebSocket();

    // Функция для копирования ID в буфер обмена
    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                console.log('ID скопирован:', text);
            }).catch(err => {
                console.error('Ошибка копирования:', err);
                // Fallback метод
                fallbackCopyToClipboard(text);
            });
        } else {
            fallbackCopyToClipboard(text);
        }
    }

    function fallbackCopyToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            console.log('ID скопирован (fallback):', text);
        } catch (err) {
            console.error('Ошибка копирования (fallback):', err);
        }
        document.body.removeChild(textArea);
    }

    // Функция для получения ID выбранного элемента
    function getSelectedElementId(element) {
        // Пытаемся найти родительский элемент чата или контакта
        const chatElement = element.closest('.item.svelte-rg2upy') || 
                          element.closest('.wrapper.wrapper--withActions') ||
                          element.closest('[class*="item"]');
        
        if (chatElement) {
            const chatId = extractChatId(chatElement);
            if (chatId) return chatId;
            
            const contactId = extractContactId(chatElement);
            if (contactId) return contactId;
        }
        
        return null;
    }

    // Добавляем кнопку копирования ID в контекстное меню
    function addCopyIdButton() {
        // Наблюдаем за появлением контекстного меню
        const menuObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        // Ищем контекстное меню (обычно это dialog или popover)
                        const menu = node.querySelector('[role="dialog"]') || 
                                    node.querySelector('[class*="menu"]') ||
                                    node.querySelector('[class*="popover"]') ||
                                    node.querySelector('[class*="Popover"]') ||
                                    (node.matches && (node.matches('[role="dialog"]') || 
                                     node.matches('[class*="menu"]') || 
                                     node.matches('[class*="popover"]')) ? node : null);
                        
                        if (menu && !menu.querySelector('.copy-chat-id-button')) {
                            // Ищем кнопки меню для определения структуры
                            const menuButtons = menu.querySelectorAll('button, [role="menuitem"]');
                            if (menuButtons.length > 0) {
                                // Находим элемент, на который было вызвано ПКМ
                                const chatItem = currentSelectedElement ||
                                               document.querySelector('.item.svelte-rg2upy:hover') ||
                                               document.querySelector('.wrapper.wrapper--withActions:hover');
                                
                                if (chatItem) {
                                    const id = getSelectedElementId(chatItem);
                                    if (id) {
                                        // Создаем кнопку копирования
                                        const copyButton = document.createElement('button');
                                        copyButton.className = 'copy-chat-id-button';
                                        copyButton.setAttribute('role', 'menuitem');
                                        copyButton.textContent = 'Скопировать ID';
                                        
                                        // Копируем стили с существующей кнопки меню
                                        const firstButton = menuButtons[0];
                                        if (firstButton) {
                                            const computedStyle = window.getComputedStyle(firstButton);
                                            copyButton.style.cssText = `
                                                width: 100%;
                                                padding: ${computedStyle.padding || '8px 16px'};
                                                text-align: left;
                                                border: none;
                                                background: transparent;
                                                cursor: pointer;
                                                font-size: ${computedStyle.fontSize || '14px'};
                                                color: ${computedStyle.color || 'inherit'};
                                                font-family: ${computedStyle.fontFamily || 'inherit'};
                                                display: flex;
                                                align-items: center;
                                            `;
                                        } else {
                                            copyButton.style.cssText = `
                                                width: 100%;
                                                padding: 8px 16px;
                                                text-align: left;
                                                border: none;
                                                background: transparent;
                                                cursor: pointer;
                                                font-size: 14px;
                                            `;
                                        }
                                        
                                        // Добавляем hover эффект
                                        copyButton.addEventListener('mouseenter', () => {
                                            copyButton.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
                                        });
                                        copyButton.addEventListener('mouseleave', () => {
                                            copyButton.style.backgroundColor = 'transparent';
                                        });
                                        
                                        copyButton.addEventListener('click', (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            copyToClipboard(String(id));
                                            
                                            // Визуальная обратная связь
                                            const originalText = copyButton.textContent;
                                            copyButton.textContent = '✓ ID скопирован!';
                                            copyButton.style.color = '#4CAF50';
                                            setTimeout(() => {
                                                copyButton.textContent = originalText;
                                                copyButton.style.color = '';
                                            }, 2000);
                                        });
                                        
                                        // Вставляем кнопку в начало меню
                                        const container = firstButton?.parentElement || menu;
                                        if (container) {
                                            // Создаем разделитель, если его нет
                                            const separator = document.createElement('div');
                                            separator.style.cssText = 'height: 1px; background: rgba(0,0,0,0.1); margin: 4px 0;';
                                            
                                            container.insertBefore(copyButton, container.firstChild);
                                            container.insertBefore(separator, copyButton.nextSibling);
                                        } else {
                                            menu.appendChild(copyButton);
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            });
        });

        menuObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Отслеживаем ПКМ для сохранения выбранного элемента
        document.addEventListener('contextmenu', (e) => {
            const target = e.target;
            const chatItem = target.closest('.item.svelte-rg2upy') || 
                           target.closest('.wrapper.wrapper--withActions') ||
                           target.closest('[class*="item"]');
            if (chatItem) {
                currentSelectedElement = chatItem;
                // Очищаем через некоторое время
                setTimeout(() => {
                    if (currentSelectedElement === chatItem) {
                        currentSelectedElement = null;
                    }
                }, 5000);
            }
        }, true);
    }

    // Запускаем добавление кнопки копирования
    addCopyIdButton();

    console.log('Скрипт показа ID чатов и контактов загружен. Ожидание данных из WebSocket...');
})();

