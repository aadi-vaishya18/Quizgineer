let configContainer = document.querySelector(".config-container");
let quizContainer = document.querySelector(".quiz-container");
let answerOptions = document.querySelector(".answer-options");
let nextQuestionBtn = document.querySelector(".next-btn");
let questionStatus = document.querySelector(".question-status");
let timerDisplay = document.querySelector(".time-duration");
let resultContainer = document.querySelector(".result-container");
let dashboardContainer = document.querySelector(".dashboard-container");
const dashboardProfile = document.querySelector(".dashboard-profile");
const totalAttemptsEl = document.querySelector("#total-attempts");
const averageScoreEl = document.querySelector("#average-score");
const highestScoreEl = document.querySelector("#highest-score");
const lastScoreEl = document.querySelector("#last-score");
const recentActivityStatus = document.querySelector(".recent-activity-status");
const recentActivityList = document.querySelector(".recent-activity-list");
const dashboardTopicSelect = document.querySelector("#dashboard-topic");
const dashboardDifficultySelect = document.querySelector("#dashboard-difficulty");
const dashboardQuestionCountSelect = document.querySelector("#dashboard-question-count");
const dashboardStartQuizBtn = document.querySelector(".dashboard-start-quiz-btn");
let subTopicChartInstance = null;
let quizHistoryChartInstance = null;
let difficultyChartInstance = null;
let selectedDifficulty = "Not Set";
const GOOGLE_SHEETS_WEBHOOK_URL = window.GOOGLE_SHEETS_WEBHOOK_URL || "";

let QUIZ_TIME_LIMIT = 15;
let currentTime = QUIZ_TIME_LIMIT;
let timer = null;
let currentQuestion = null;
let questionsIndexHistory = [];
let correctAnswersCount = 0;
let quizCategory = "";
let numberOfQuestions = 0;
let activeQuestionSet = [];
let selectedTopicKey = "";
let currentQuestionSetIndex = -1;
let quizAttemptAnswers = [];
let latestQuizResult = null;
let isResultPersisted = false;

const topicKeyAliases = {
    dsa: "DSA",
    aptitude: "Aptitude",
    apptitude: "Aptitude",
    logicalreasoning: "Logical Reasoning",
    coreengineering: "Core Engineering"
};

const normalizeTopicKey = value => (value || "").toLowerCase().replace(/[^a-z]/g, "");

const resolveTopicCategory = value => {
    const normalized = normalizeTopicKey(value);
    return topicKeyAliases[normalized] || value;
};

const destroyChartIfAny = chartInstance => {
    if (chartInstance) {
        chartInstance.destroy();
    }
};

const renderSubTopicPerformanceChart = results => {
    const canvas = document.querySelector("#subTopicChart");
    if (!canvas || typeof Chart === "undefined") return;

    const topicMap = {};
    results.forEach(result => {
        const topic = result.topic || "Unknown";
        topicMap[topic] = topicMap[topic] || { totalScore: 0, count: 0 };
        topicMap[topic].totalScore += Number(result.score) || 0;
        topicMap[topic].count += 1;
    });

    const labels = Object.keys(topicMap);
    const values = labels.map(topic => Math.round(topicMap[topic].totalScore / topicMap[topic].count));

    destroyChartIfAny(subTopicChartInstance);
    subTopicChartInstance = new Chart(canvas, {
        type: "bar",
        data: {
            labels: labels.length ? labels : ["No Data"],
            datasets: [
                {
                    label: "Average Score",
                    data: values.length ? values : [0],
                    backgroundColor: "#60a5fa",
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, max: 100 } }
        }
    });
};

const renderQuizHistoryChart = results => {
    const canvas = document.querySelector("#quizHistoryChart");
    if (!canvas || typeof Chart === "undefined") return;

    const ordered = [...results].reverse();
    const labels = ordered.map((_, index) => `Attempt ${index + 1}`);
    const data = ordered.map(result => Number(result.score) || 0);

    destroyChartIfAny(quizHistoryChartInstance);
    quizHistoryChartInstance = new Chart(canvas, {
        type: "line",
        data: {
            labels: labels.length ? labels : ["Attempt 1"],
            datasets: [
                {
                    label: "Score",
                    data: data.length ? data : [0],
                    borderColor: "#2563eb",
                    backgroundColor: "rgba(37, 99, 235, 0.15)",
                    fill: true,
                    tension: 0.35
                }
            ]
        },
        options: {
            responsive: true,
            scales: { y: { beginAtZero: true, max: 100 } }
        }
    });
};

const renderDifficultyAnalysisChart = results => {
    const canvas = document.querySelector("#difficultyChart");
    if (!canvas || typeof Chart === "undefined") return;

    const difficultyMap = { Easy: 0, Medium: 0, Hard: 0, "Not Set": 0 };
    results.forEach(result => {
        const difficulty = result.difficulty || "Not Set";
        if (typeof difficultyMap[difficulty] !== "number") {
            difficultyMap["Not Set"] += 1;
            return;
        }
        difficultyMap[difficulty] += 1;
    });

    const labels = Object.keys(difficultyMap);
    const data = labels.map(label => difficultyMap[label]);

    destroyChartIfAny(difficultyChartInstance);
    difficultyChartInstance = new Chart(canvas, {
        type: "pie",
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: ["#93c5fd", "#60a5fa", "#2563eb", "#cbd5e1"]
                }
            ]
        },
        options: { responsive: true }
    });
};

const updatePerformanceCards = results => {
    const total = results.length;
    const scores = results.map(result => Number(result.score) || 0);
    const average = total ? Math.round(scores.reduce((sum, score) => sum + score, 0) / total) : 0;
    const highest = total ? Math.max(...scores) : 0;
    const lastScore = total ? scores[0] : 0;

    totalAttemptsEl.textContent = String(total);
    averageScoreEl.textContent = `${average}%`;
    highestScoreEl.textContent = `${highest}%`;
    lastScoreEl.textContent = `${lastScore}%`;
};

const formatTimestamp = timestampValue => {
    if (!timestampValue) return "Date unavailable";
    if (typeof timestampValue.toDate === "function") {
        return timestampValue.toDate().toLocaleString();
    }

    const parsedDate = new Date(timestampValue);
    if (Number.isNaN(parsedDate.getTime())) return "Date unavailable";
    return parsedDate.toLocaleString();
};

const getTimestampMillis = timestampValue => {
    if (!timestampValue) return 0;
    if (typeof timestampValue.toDate === "function") {
        return timestampValue.toDate().getTime();
    }

    const parsedDate = new Date(timestampValue);
    return Number.isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime();
};

const renderRecentActivity = results => {
    if (!recentActivityList || !recentActivityStatus) return;
    recentActivityList.innerHTML = "";

    const latestFive = results.slice(0, 5);
    if (!latestFive.length) {
        recentActivityStatus.textContent = "No quiz attempts found yet.";
        return;
    }

    recentActivityStatus.textContent = "";

    latestFive.forEach(result => {
        const item = document.createElement("li");
        item.className = "recent-activity-item";

        const topic = result.topic || "Unknown Topic";
        const difficulty = result.difficulty || "Not Set";
        const formattedDate = formatTimestamp(result.timestamp || result.submittedAt);
        const score = Number(result.score) || 0;

        item.innerHTML = `
            <div class="recent-activity-meta">
                <span><strong>Topic:</strong> ${topic}</span>
                <span><strong>Difficulty:</strong> ${difficulty}</span>
                <span><strong>Date:</strong> ${formattedDate}</span>
            </div>
            <p class="recent-activity-score">${score}%</p>
        `;
        recentActivityList.appendChild(item);
    });
};

const getClientTimestamp = () => new Date().toISOString();

const sendResultToGoogleSheets = async ({ resultObject, profileData = {} }) => {
    if (!GOOGLE_SHEETS_WEBHOOK_URL || !resultObject) {
        console.warn("Google Sheets webhook skipped: URL or result object missing.");
        return;
    }

    const payload = {
        name: profileData.name || window.currentUser?.displayName || "",
        email: profileData.email || window.currentUser?.email || "",
        rollNumber: profileData.rollNumber || "",
        branch: profileData.branch || "",
        score: resultObject.score ?? 0,
        difficulty: resultObject.difficulty || "Not Set",
        timestamp: getClientTimestamp()
    };

    try {
        const response = await fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Webhook responded with status ${response.status}`);
        }

        console.info("Google Sheets sync successful.", {
            score: payload.score,
            difficulty: payload.difficulty,
            email: payload.email
        });
    } catch (error) {
        console.warn("Google Sheets CORS request failed, retrying with no-cors mode.", error);

        try {
            // Apps Script web apps often fail CORS preflight; this fallback still sends the payload.
            await fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(payload)
            });

            console.info("Google Sheets sync request sent in no-cors mode.", {
                score: payload.score,
                difficulty: payload.difficulty,
                email: payload.email
            });
        } catch (fallbackError) {
            console.error("Google Sheets sync failed in both modes.", {
                error: fallbackError,
                webhook: GOOGLE_SHEETS_WEBHOOK_URL,
                payloadPreview: payload
            });
        }
    }
};

const loadDashboardData = async () => {
    if (!db || !window.currentUser) {
        updatePerformanceCards([]);
        renderSubTopicPerformanceChart([]);
        renderQuizHistoryChart([]);
        renderDifficultyAnalysisChart([]);
        renderRecentActivity([]);
        return;
    }

    try {
        let results = [];

        try {
            const indexedSnapshot = await db
                .collection("results")
                .where("userId", "==", window.currentUser.uid)
                .orderBy("timestamp", "desc")
                .limit(20)
                .get();
            results = indexedSnapshot.docs.map(doc => doc.data());
        } catch (indexedQueryError) {
            console.warn("Indexed dashboard query failed, using fallback query:", indexedQueryError);
            const fallbackSnapshot = await db
                .collection("results")
                .where("userId", "==", window.currentUser.uid)
                .limit(50)
                .get();

            results = fallbackSnapshot.docs
                .map(doc => doc.data())
                .sort(
                    (a, b) =>
                        getTimestampMillis(b.timestamp || b.submittedAt) -
                        getTimestampMillis(a.timestamp || a.submittedAt)
                )
                .slice(0, 20);
        }

        updatePerformanceCards(results);
        renderSubTopicPerformanceChart(results);
        renderQuizHistoryChart(results);
        renderDifficultyAnalysisChart(results);
        renderRecentActivity(results);
    } catch (error) {
        console.error("Unable to load dashboard analytics:", error);
        updatePerformanceCards([]);
        renderSubTopicPerformanceChart([]);
        renderQuizHistoryChart([]);
        renderDifficultyAnalysisChart([]);
        renderRecentActivity([]);
    }
};

window.showDashboard = async () => {
    dashboardContainer.style.display = "block";
    configContainer.style.display = "none";
    quizContainer.style.display = "none";
    resultContainer.style.display = "none";
    dashboardProfile.textContent = window.currentUser?.displayName || window.currentUser?.email || "User";
    await loadDashboardData();
};

let resetTimer = () => {
    clearInterval(timer);
    currentTime = QUIZ_TIME_LIMIT;
    timerDisplay.textContent = `${currentTime}s`;
};

let clearQuizProgress = () => {
    resetTimer();
    currentQuestion = null;
    currentQuestionSetIndex = -1;
    questionsIndexHistory = [];
    correctAnswersCount = 0;
    quizAttemptAnswers = [];
    latestQuizResult = null;
    isResultPersisted = false;
    questionStatus.textContent = "";
    answerOptions.innerHTML = "";
    nextQuestionBtn.style.visibility = "hidden";
};
let generateResultFeedback = scorePercentage => {
    if (scorePercentage >= 85) return "Excellent performance! You have a strong command of this topic.";
    if (scorePercentage >= 65) return "Good job! A little more practice can make this score even better.";
    if (scorePercentage >= 40) return "Decent attempt. Review concepts and retry to improve your accuracy.";
    return "Keep practicing. Focus on basics and attempt again for a better score.";
};

let buildQuizResultObject = () => {
    let totalQuestions = numberOfQuestions || 0;
    let correctAnswers = correctAnswersCount;
    let wrongAnswers = quizAttemptAnswers.filter(answer => !answer.isCorrect && !answer.timedOut).length;
    let unanswered = quizAttemptAnswers.filter(answer => answer.timedOut).length;
    let scorePercentage = totalQuestions ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
    const subTopicPerformance = quizAttemptAnswers.reduce((accumulator, answer) => {
        const subTopicKey = answer.subTopic || "General";
        if (!accumulator[subTopicKey]) {
            accumulator[subTopicKey] = { correct: 0, total: 0 };
        }

        accumulator[subTopicKey].total += 1;
        if (answer.isCorrect) {
            accumulator[subTopicKey].correct += 1;
        }
        return accumulator;
    }, {});

    return {
        userId: window.currentUser?.uid || null,
        topic: quizCategory,
        difficulty: selectedDifficulty || "Not Set",
        score: scorePercentage,
        correctAnswers,
        wrongAnswers,
        unanswered,
        totalQuestions,
        answers: [...quizAttemptAnswers],
        subTopicPerformance,
        feedback: generateResultFeedback(scorePercentage),
        submittedAt: new Date().toISOString()
    };
};

let persistQuizResult = async resultObject => {
    if (!db || !window.currentUser || isResultPersisted || !resultObject) return null;

    const firestore = firebase.firestore;
    let profileData = {};

    try {
        const userProfileDoc = await db.collection("users").doc(window.currentUser.uid).get();
        profileData = userProfileDoc.exists ? userProfileDoc.data() || {} : {};
    } catch (error) {
        console.error("Unable to load user profile for result payload:", error);
    }

    const resultPayload = {
        userId: resultObject.userId,
        name: profileData.name || window.currentUser.displayName || "",
        branch: profileData.branch || "",
        rollNumber: profileData.rollNumber || "",
        difficulty: resultObject.difficulty || "Not Set",
        topic: resultObject.topic,
        score: resultObject.score,
        correctAnswers: resultObject.correctAnswers,
        wrongAnswers: resultObject.wrongAnswers,
        unanswered: resultObject.unanswered,
        totalQuestions: resultObject.totalQuestions,
        answers: resultObject.answers,
        subTopicPerformance: resultObject.subTopicPerformance || {},
        timestamp: firestore.FieldValue.serverTimestamp()
    };

    const resultDocRef = await db.collection("results").add(resultPayload);

    const historyEntry = {
        resultId: resultDocRef.id,
        topic: resultObject.topic,
        score: resultObject.score,
        correctAnswers: resultObject.correctAnswers,
        totalQuestions: resultObject.totalQuestions,
        timestamp: firestore.FieldValue.serverTimestamp()
    };

    await db.collection("users").doc(window.currentUser.uid).set(
        {
            name: window.currentUser.displayName || "",
            email: window.currentUser.email || "",
            quizHistory: firestore.FieldValue.arrayUnion(historyEntry),
            updatedAt: firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
    );

    await sendResultToGoogleSheets({ resultObject, profileData });

    isResultPersisted = true;
    return resultDocRef.id;
};

let showQuizResult = async () => {
    quizContainer.style.display = "none";
    resultContainer.style.display = "block";
    if (!latestQuizResult) {
        latestQuizResult = buildQuizResultObject();
    }

    let resultText = `Score: <b>${latestQuizResult.score}%</b><br>
Correct: <b>${latestQuizResult.correctAnswers}</b> | Wrong: <b>${latestQuizResult.wrongAnswers}</b> | Unanswered: <b>${latestQuizResult.unanswered}</b><br>
${latestQuizResult.feedback}`;

    document.querySelector(".result-message").innerHTML = resultText;
    const breakdownList = document.querySelector(".result-breakdown-list");
    const subTopicList = document.querySelector(".result-subtopic-list");

    if (breakdownList) {
        breakdownList.innerHTML = `
            <li><strong>Topic:</strong> ${latestQuizResult.topic || "General"}</li>
            <li><strong>Difficulty:</strong> ${latestQuizResult.difficulty || "Not Set"}</li>
            <li><strong>Total Questions:</strong> ${latestQuizResult.totalQuestions}</li>
            <li><strong>Correct:</strong> ${latestQuizResult.correctAnswers}</li>
            <li><strong>Wrong:</strong> ${latestQuizResult.wrongAnswers}</li>
            <li><strong>Unanswered:</strong> ${latestQuizResult.unanswered}</li>
        `;
    }

    if (subTopicList) {
        const performance = latestQuizResult.subTopicPerformance || {};
        const entries = Object.entries(performance);

        if (!entries.length) {
            subTopicList.innerHTML = "<li>No sub-topic data available.</li>";
        } else {
            subTopicList.innerHTML = entries
                .map(
                    ([subTopic, stats]) =>
                        `<li><strong>${subTopic}:</strong> ${stats.correct}/${stats.total} correct</li>`
                )
                .join("");
        }
    }

    try {
        const resultId = await persistQuizResult(latestQuizResult);
        if (resultId) {
            window.latestResultId = resultId;
        }
    } catch (error) {
        console.error("Unable to store quiz result:", error);
    }
};

let startTimer = () => {
    timer = setInterval(() => {
        currentTime--;
        timerDisplay.textContent = `${currentTime}s`;

        if (currentTime <= 0) {
            handleQuestionTimeout();
        }
    }, 1000);
};

let getRandomQuestions = () => {
    if (!quizCategory || !Array.isArray(activeQuestionSet) || !activeQuestionSet.length) return null;

    if (questionsIndexHistory.length >= Math.min(activeQuestionSet.length, numberOfQuestions)) {
        showQuizResult();
        return null;
    }

    let availableIndexes = activeQuestionSet
        .map((_, index) => index)
        .filter(index => !questionsIndexHistory.includes(index));

    if (!availableIndexes.length) {
        showQuizResult();
        return null;
    }

    let randomIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
    questionsIndexHistory.push(randomIndex);
    currentQuestionSetIndex = randomIndex;
    return activeQuestionSet[randomIndex];
};

const getLocalTopicQuestions = topic => {
    const resolvedTopic = resolveTopicCategory(topic);
    const categoryObj = questions.find(
        category => normalizeTopicKey(category.category) === normalizeTopicKey(resolvedTopic)
    );

    if (!categoryObj || !Array.isArray(categoryObj.questions)) return [];
    return categoryObj.questions
        .map(question => sanitizeFetchedQuestion(question, resolvedTopic, selectedDifficulty))
        .filter(Boolean);
};

const sanitizeFetchedQuestion = (question, fallbackTopic = quizCategory, fallbackDifficulty = selectedDifficulty) => {
    if (!question || typeof question.question !== "string") return null;
    if (!Array.isArray(question.options) || question.options.length < 2) return null;

    const correctAnswer = Number(question.correctAnswer);
    if (Number.isNaN(correctAnswer) || correctAnswer < 0 || correctAnswer >= question.options.length) {
        return null;
    }

    return {
        question: question.question,
        options: question.options,
        correctAnswer,
        topic: question.topic || fallbackTopic || "General",
        subTopic: question.subTopic || question.topic || fallbackTopic || "General",
        difficulty: question.difficulty || fallbackDifficulty || "Not Set"
    };
};

const fetchTopicQuestions = async topic => {
    const fallbackQuestions = getLocalTopicQuestions(topic);

    if (!db) {
        return fallbackQuestions;
    }

    try {
        const topicDoc = await db.collection("quizTopics").doc(resolveTopicCategory(topic)).get();
        if (!topicDoc.exists) {
            return fallbackQuestions;
        }

        const topicData = topicDoc.data() || {};
        const firestoreQuestions = Array.isArray(topicData.questions) ? topicData.questions : [];
        const sanitizedQuestions = firestoreQuestions
            .map(question => sanitizeFetchedQuestion(question, resolveTopicCategory(topic), selectedDifficulty))
            .filter(Boolean);

        return sanitizedQuestions.length ? sanitizedQuestions : fallbackQuestions;
    } catch (error) {
        console.error("Unable to fetch topic questions from Firestore:", error);
        return fallbackQuestions;
    }
};

let highlightCorrectAnswer = () => {
    let correctOption = answerOptions.querySelectorAll(".answer-option")[currentQuestion.correctAnswer];

    if (!correctOption) return;

    correctOption.classList.add("correct");
    correctOption.insertAdjacentHTML(
        "beforeend",
        `<span class="material-symbols-rounded">check_circle</span>`
    );
};

let trackUserAnswer = ({ selectedAnswerIndex = null, isCorrect = false, timedOut = false }) => {
    if (!currentQuestion || currentQuestionSetIndex < 0) return;

    let answerRecord = {
        questionIndex: questionsIndexHistory.length,
        questionSetIndex: currentQuestionSetIndex,
        topic: currentQuestion.topic || quizCategory,
        subTopic: currentQuestion.subTopic || currentQuestion.topic || quizCategory || "General",
        difficulty: currentQuestion.difficulty || selectedDifficulty || "Not Set",
        question: currentQuestion.question,
        options: [...currentQuestion.options],
        selectedAnswerIndex,
        selectedAnswer:
            selectedAnswerIndex === null ? null : currentQuestion.options[selectedAnswerIndex] || null,
        correctAnswerIndex: currentQuestion.correctAnswer,
        correctAnswer: currentQuestion.options[currentQuestion.correctAnswer],
        isCorrect,
        timedOut
    };

    let existingRecordIndex = quizAttemptAnswers.findIndex(
        record => record.questionSetIndex === currentQuestionSetIndex
    );

    if (existingRecordIndex >= 0) {
        quizAttemptAnswers[existingRecordIndex] = answerRecord;
    } else {
        quizAttemptAnswers.push(answerRecord);
    }
};

let handleQuestionTimeout = () => {
    clearInterval(timer);

    if (!currentQuestion) return;

    let alreadyRecorded = quizAttemptAnswers.some(
        record => record.questionSetIndex === currentQuestionSetIndex
    );

    if (!alreadyRecorded) {
        trackUserAnswer({
            selectedAnswerIndex: null,
            isCorrect: false,
            timedOut: true
        });
    }

    highlightCorrectAnswer();
    nextQuestionBtn.style.visibility = "visible";
    quizContainer.querySelector(".quiz-timer").style.background = "#c31402";

    answerOptions.querySelectorAll(".answer-option").forEach(option => {
        option.style.pointerEvents = "none";
    });
};

let handleAnswer = (option, answerIndex) => {
    if (!currentQuestion) return;
    clearInterval(timer);

    let isCorrect = currentQuestion.correctAnswer === answerIndex;
    option.classList.add(isCorrect ? "correct" : "incorrect");

    if (!isCorrect) {
        highlightCorrectAnswer();
    } else {
        correctAnswersCount++;
    }

    trackUserAnswer({
        selectedAnswerIndex: answerIndex,
        isCorrect,
        timedOut: false
    });

    option.insertAdjacentHTML(
        "beforeend",
        `<span class="material-symbols-rounded">${isCorrect ? "check_circle" : "cancel"}</span>`
    );

    answerOptions.querySelectorAll(".answer-option").forEach(answerOption => {
        answerOption.style.pointerEvents = "none";
    });

    nextQuestionBtn.style.visibility = "visible";
};

let renderQuestion = () => {
    currentQuestion = getRandomQuestions();
    if (!currentQuestion) return;

    resetTimer();
    startTimer();

    answerOptions.innerHTML = "";
    nextQuestionBtn.style.visibility = "hidden";
    quizContainer.querySelector(".quiz-timer").style.background = "#32313c";
    document.querySelector(".question-text").textContent = currentQuestion.question;

    questionStatus.innerHTML = `<b>${questionsIndexHistory.length}</b> of <b>${numberOfQuestions}</b> Questions`;

    currentQuestion.options.forEach((option, index) => {
        let listItem = document.createElement("li");
        listItem.classList.add("answer-option");
        listItem.textContent = option;
        answerOptions.appendChild(listItem);
        listItem.addEventListener("click", () => handleAnswer(listItem, index));
    });
};

window.getCurrentQuizAttemptSnapshot = () => ({
    topic: quizCategory,
    totalQuestions: numberOfQuestions,
    correctAnswers: correctAnswersCount,
    answers: [...quizAttemptAnswers],
    latestResult: latestQuizResult
});

let startQuiz = async () => {
    if (!window.currentUser) {
        if (typeof window.setAuthMessage === "function") {
            window.setAuthMessage("Please login before starting the quiz.", "error");
        }
        if (typeof window.showAuthScreen === "function") {
            window.showAuthScreen();
        }
        return;
    }

    const selectedCategoryButton = configContainer.querySelector(".category-option.active");
    quizCategory = resolveTopicCategory(selectedCategoryButton?.dataset.topic || selectedCategoryButton?.textContent);
    selectedTopicKey = normalizeTopicKey(quizCategory);
    selectedDifficulty = "Not Set";

    numberOfQuestions = parseInt(
        configContainer.querySelector(".question-option.active")?.textContent
    );
    if (!selectedTopicKey || !quizCategory) {
        if (typeof window.setAuthMessage === "function") {
            window.setAuthMessage("Please select a valid topic before starting.", "error");
        }
        return;
    }

    if (!Number.isInteger(numberOfQuestions) || numberOfQuestions <= 0) {
        if (typeof window.setAuthMessage === "function") {
            window.setAuthMessage("Please select a valid number of questions.", "error");
        }
        return;
    }

    if (typeof window.setAuthMessage === "function") {
        window.setAuthMessage("Loading questions...", "success");
    }

    activeQuestionSet = await fetchTopicQuestions(quizCategory);
    if (!activeQuestionSet.length) {
        if (typeof window.setAuthMessage === "function") {
            window.setAuthMessage("No questions available for this topic right now.", "error");
        }
        return;
    }

    configContainer.style.display = "none";
    quizContainer.style.display = "block";

    correctAnswersCount = 0;
    questionsIndexHistory = [];
    quizAttemptAnswers = [];
    latestQuizResult = null;
    isResultPersisted = false;
    window.latestResultId = null;
    numberOfQuestions = Math.min(numberOfQuestions, activeQuestionSet.length);

    if (typeof window.setAuthMessage === "function") {
        window.setAuthMessage("");
    }

    renderQuestion();
};

const startQuizFromDashboard = async () => {
    if (!window.currentUser) {
        showAuthScreen("Please login before starting the quiz.");
        return;
    }

    const selectedTopic = resolveTopicCategory(dashboardTopicSelect?.value || "");
    const selectedCount = Number(dashboardQuestionCountSelect?.value || 0);
    const chosenDifficulty = dashboardDifficultySelect?.value || "Not Set";

    if (!selectedTopic || !selectedCount) {
        setAuthMessage("Please choose topic and question count.", "error");
        return;
    }

    quizCategory = selectedTopic;
    selectedTopicKey = normalizeTopicKey(quizCategory);
    numberOfQuestions = selectedCount;
    selectedDifficulty = chosenDifficulty;

    setAuthMessage("Loading questions...", "success");
    activeQuestionSet = await fetchTopicQuestions(quizCategory);

    if (!activeQuestionSet.length) {
        setAuthMessage("No questions available for this topic right now.", "error");
        return;
    }

    dashboardContainer.style.display = "none";
    configContainer.style.display = "none";
    quizContainer.style.display = "block";

    correctAnswersCount = 0;
    questionsIndexHistory = [];
    quizAttemptAnswers = [];
    latestQuizResult = null;
    isResultPersisted = false;
    window.latestResultId = null;
    numberOfQuestions = Math.min(numberOfQuestions, activeQuestionSet.length);
    setAuthMessage("");

    renderQuestion();
};

let resetQuiz = () => {
    clearQuizProgress();
    quizContainer.style.display = "none";
    resultContainer.style.display = "none";
    activeQuestionSet = [];
    selectedTopicKey = "";

    if (window.currentUser) {
        window.showDashboard();
    }
};

window.resetQuizToInitialState = () => {
    clearQuizProgress();
    dashboardContainer.style.display = "none";
    configContainer.style.display = "none";
    quizContainer.style.display = "none";
    resultContainer.style.display = "none";
    activeQuestionSet = [];
    selectedTopicKey = "";
};

window.showQuizConfiguration = () => {
    dashboardContainer.style.display = "none";
    configContainer.style.display = "block";
    quizContainer.style.display = "none";
    resultContainer.style.display = "none";
};
document.querySelectorAll(".category-option").forEach(option => {
    option.dataset.topic = resolveTopicCategory(option.textContent.trim());
});

document.querySelectorAll(".category-option, .question-option").forEach(option => {
    option.addEventListener("click", () => {
        let activeOption = option.parentNode.querySelector(".active");
        if (activeOption) {
            activeOption.classList.remove("active");
        }
        option.classList.add("active");
    });
});

nextQuestionBtn.addEventListener("click", renderQuestion);
document.querySelector(".restart-btn").addEventListener("click", resetQuiz);
document.querySelector(".start-btn").addEventListener("click", startQuiz);
dashboardStartQuizBtn.addEventListener("click", startQuizFromDashboard);

const authContainer = document.querySelector(".auth-container");
const sessionControls = document.querySelector(".session-controls");
const sessionUser = document.querySelector(".session-user");
const logoutButton = document.querySelector(".logout-btn");
const authTabs = document.querySelectorAll(".auth-tab");
const authForm = document.querySelector(".auth-form");
const authNameField = document.querySelector(".name-field");
const authNameInput = document.querySelector("#auth-name");
const authBranchField = document.querySelector(".branch-field");
const authBranchInput = document.querySelector("#auth-branch");
const authRollField = document.querySelector(".roll-field");
const authRollInput = document.querySelector("#auth-roll");
const authPhoneField = document.querySelector(".phone-field");
const authPhoneInput = document.querySelector("#auth-phone");
const authEmailInput = document.querySelector("#auth-email");
const authPasswordInput = document.querySelector("#auth-password");
const authSubmitButton = document.querySelector(".auth-submit-btn");
const authMessage = document.querySelector(".auth-message");

const auth = window.firebaseServices?.auth || null;
const db = window.firebaseServices?.db || null;
let authMode = "login";
window.currentUser = null;

const setAuthMessage = (message = "", type = "error") => {
    authMessage.textContent = message;
    authMessage.classList.remove("error", "success");

    if (message) {
        authMessage.classList.add(type);
    }
};

window.setAuthMessage = setAuthMessage;

const showAuthScreen = (message = "") => {
    authContainer.style.display = "block";
    dashboardContainer.style.display = "none";
    configContainer.style.display = "none";
    quizContainer.style.display = "none";
    resultContainer.style.display = "none";
    sessionControls.style.display = "none";
    sessionUser.textContent = "";

    if (message) {
        setAuthMessage(message, "error");
    }
};

window.showAuthScreen = showAuthScreen;

const showLoggedInState = user => {
    authContainer.style.display = "none";
    sessionControls.style.display = "flex";
    sessionUser.textContent = user.displayName || user.email || "Logged in user";

    if (typeof window.showDashboard === "function") {
        window.showDashboard();
    } else {
        dashboardContainer.style.display = "none";
        configContainer.style.display = "block";
        quizContainer.style.display = "none";
        resultContainer.style.display = "none";
    }
};

const setAuthMode = mode => {
    authMode = mode;

    authTabs.forEach(tab => {
        tab.classList.toggle("active", tab.dataset.mode === mode);
    });

    authNameField.classList.toggle("hidden", mode !== "signup");
    authBranchField.classList.toggle("hidden", mode !== "signup");
    authRollField.classList.toggle("hidden", mode !== "signup");
    authPhoneField.classList.toggle("hidden", mode !== "signup");
    authPasswordInput.setAttribute(
        "autocomplete",
        mode === "signup" ? "new-password" : "current-password"
    );
    authSubmitButton.textContent = mode === "signup" ? "Create Account" : "Login";
    setAuthMessage("");
};

const validateCredentials = ({ name, email, branch, rollNumber, phoneNumber, password }) => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedBranch = branch.trim();
    const trimmedRollNumber = rollNumber.trim();
    const trimmedPhoneNumber = phoneNumber.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[0-9]{10}$/;

    if (authMode === "signup" && trimmedName.length < 2) {
        return { valid: false, message: "Enter a valid full name (minimum 2 characters)." };
    }

    if (authMode === "signup" && trimmedBranch.length < 2) {
        return { valid: false, message: "Enter a valid branch." };
    }

    if (authMode === "signup" && trimmedRollNumber.length < 2) {
        return { valid: false, message: "Enter a valid roll number." };
    }

    if (authMode === "signup" && !phoneRegex.test(trimmedPhoneNumber)) {
        return { valid: false, message: "Enter a valid 10-digit phone number." };
    }

    if (!emailRegex.test(trimmedEmail)) {
        return { valid: false, message: "Enter a valid email address." };
    }

    if (password.length < 6) {
        return { valid: false, message: "Password must be at least 6 characters long." };
    }

    return {
        valid: true,
        data: {
            name: trimmedName,
            email: trimmedEmail,
            branch: trimmedBranch,
            rollNumber: trimmedRollNumber,
            phoneNumber: trimmedPhoneNumber,
            password
        }
    };
};

const getFirebaseErrorMessage = errorCode => {
    switch (errorCode) {
        case "auth/email-already-in-use":
            return "This email is already registered. Please login instead.";
        case "auth/invalid-email":
            return "Invalid email format.";
        case "auth/weak-password":
            return "Password is too weak. Use at least 6 characters.";
        case "auth/invalid-credential":
        case "auth/wrong-password":
        case "auth/user-not-found":
            return "Invalid email or password.";
        case "auth/too-many-requests":
            return "Too many attempts. Please wait and try again.";
        default:
            return "Authentication failed. Please try again.";
    }
};

const createOrUpdateUserProfile = async (user, profileOverrides = {}) => {
    if (!db || !user) return;

    const userRef = db.collection("users").doc(user.uid);
    const userSnapshot = await userRef.get();

    const profileData = {
        name: user.displayName || "",
        email: user.email || "",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (profileOverrides.branch) {
        profileData.branch = profileOverrides.branch;
    }
    if (profileOverrides.rollNumber) {
        profileData.rollNumber = profileOverrides.rollNumber;
    }
    if (profileOverrides.phoneNumber) {
        profileData.phoneNumber = profileOverrides.phoneNumber;
    }

    if (!userSnapshot.exists) {
        profileData.quizHistory = [];
        profileData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    await userRef.set(profileData, { merge: true });
};

const handleSignup = async ({ name, email, branch, rollNumber, phoneNumber, password }) => {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);

    if (name) {
        await userCredential.user.updateProfile({ displayName: name });
    }

    await createOrUpdateUserProfile({
        ...userCredential.user,
        displayName: name || userCredential.user.displayName
    }, { branch, rollNumber, phoneNumber });
};

const handleLogin = async ({ email, password }) => {
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    await createOrUpdateUserProfile(userCredential.user);
};

const handleAuthSubmit = async event => {
    event.preventDefault();

    if (!auth) {
        setAuthMessage("Firebase Authentication is not ready. Check your Firebase config.", "error");
        return;
    }

    const validationResult = validateCredentials({
        name: authNameInput.value,
        branch: authBranchInput.value,
        rollNumber: authRollInput.value,
        phoneNumber: authPhoneInput.value,
        email: authEmailInput.value,
        password: authPasswordInput.value
    });

    if (!validationResult.valid) {
        setAuthMessage(validationResult.message, "error");
        return;
    }

    authSubmitButton.disabled = true;
    setAuthMessage(
        authMode === "signup" ? "Creating your account..." : "Logging you in...",
        "success"
    );

    try {
        if (authMode === "signup") {
            await handleSignup(validationResult.data);
        } else {
            await handleLogin(validationResult.data);
        }

        authForm.reset();
        setAuthMode("login");
    } catch (error) {
        setAuthMessage(getFirebaseErrorMessage(error.code), "error");
    } finally {
        authSubmitButton.disabled = false;
    }
};

const handleLogout = async () => {
    if (!auth || !window.currentUser) {
        showAuthScreen();
        return;
    }

    try {
        await auth.signOut();
    } catch (error) {
        setAuthMessage("Logout failed. Please try again.", "error");
    }
};

authTabs.forEach(tab => {
    tab.addEventListener("click", () => setAuthMode(tab.dataset.mode));
});

authForm.addEventListener("submit", handleAuthSubmit);
logoutButton.addEventListener("click", handleLogout);

if (!auth) {
    authSubmitButton.disabled = true;
    showAuthScreen("Firebase Authentication is not ready. Update your Firebase configuration.");
} else {
    showAuthScreen();

    auth.onAuthStateChanged(async user => {
        window.currentUser = user;

        if (user) {
            setAuthMessage("");
            try {
                await createOrUpdateUserProfile(user);
            } catch (error) {
                console.error("Unable to sync user profile:", error);
            }
            showLoggedInState(user);
            return;
        }

        if (typeof window.resetQuizToInitialState === "function") {
            window.resetQuizToInitialState();
        }

        authForm.reset();
        setAuthMode("login");
        showAuthScreen("Please login to continue.");
    });
}
