let configContainer = document.querySelector(".config-container");
let quizContainer = document.querySelector(".quiz-container");
let answerOptions = document.querySelector(".answer-options");
let nextQuestionBtn = document.querySelector(".next-btn");
let questionStatus = document.querySelector(".question-status");
let timerDisplay = document.querySelector(".time-duration");
let resultContainer = document.querySelector(".result-container");

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

    return {
        userId: window.currentUser?.uid || null,
        topic: quizCategory,
        score: scorePercentage,
        correctAnswers,
        wrongAnswers,
        unanswered,
        totalQuestions,
        answers: [...quizAttemptAnswers],
        feedback: generateResultFeedback(scorePercentage),
        submittedAt: new Date().toISOString()
    };
};

let persistQuizResult = async resultObject => {
    if (!db || !window.currentUser || isResultPersisted || !resultObject) return null;

    const firestore = firebase.firestore;
    const resultPayload = {
        userId: resultObject.userId,
        topic: resultObject.topic,
        score: resultObject.score,
        correctAnswers: resultObject.correctAnswers,
        wrongAnswers: resultObject.wrongAnswers,
        unanswered: resultObject.unanswered,
        totalQuestions: resultObject.totalQuestions,
        answers: resultObject.answers,
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
    return categoryObj.questions;
};

const sanitizeFetchedQuestion = question => {
    if (!question || typeof question.question !== "string") return null;
    if (!Array.isArray(question.options) || question.options.length < 2) return null;

    const correctAnswer = Number(question.correctAnswer);
    if (Number.isNaN(correctAnswer) || correctAnswer < 0 || correctAnswer >= question.options.length) {
        return null;
    }

    return {
        question: question.question,
        options: question.options,
        correctAnswer
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
            .map(sanitizeFetchedQuestion)
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
        topic: quizCategory,
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

let resetQuiz = () => {
    clearQuizProgress();
    quizContainer.style.display = "none";
    resultContainer.style.display = "none";
    activeQuestionSet = [];
    selectedTopicKey = "";

    if (window.currentUser) {
        configContainer.style.display = "block";
    }
};

window.resetQuizToInitialState = () => {
    clearQuizProgress();
    configContainer.style.display = "none";
    quizContainer.style.display = "none";
    resultContainer.style.display = "none";
    activeQuestionSet = [];
    selectedTopicKey = "";
};

window.showQuizConfiguration = () => {
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

const authContainer = document.querySelector(".auth-container");
const sessionControls = document.querySelector(".session-controls");
const sessionUser = document.querySelector(".session-user");
const logoutButton = document.querySelector(".logout-btn");
const authTabs = document.querySelectorAll(".auth-tab");
const authForm = document.querySelector(".auth-form");
const authNameField = document.querySelector(".name-field");
const authNameInput = document.querySelector("#auth-name");
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

    if (typeof window.showQuizConfiguration === "function") {
        window.showQuizConfiguration();
    } else {
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
    authPasswordInput.setAttribute(
        "autocomplete",
        mode === "signup" ? "new-password" : "current-password"
    );
    authSubmitButton.textContent = mode === "signup" ? "Create Account" : "Login";
    setAuthMessage("");
};

const validateCredentials = ({ name, email, password }) => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (authMode === "signup" && trimmedName.length < 2) {
        return { valid: false, message: "Enter a valid full name (minimum 2 characters)." };
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

const createOrUpdateUserProfile = async user => {
    if (!db || !user) return;

    const userRef = db.collection("users").doc(user.uid);
    const userSnapshot = await userRef.get();

    const profileData = {
        name: user.displayName || "",
        email: user.email || "",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!userSnapshot.exists) {
        profileData.quizHistory = [];
        profileData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    }

    await userRef.set(profileData, { merge: true });
};

const handleSignup = async ({ name, email, password }) => {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);

    if (name) {
        await userCredential.user.updateProfile({ displayName: name });
    }

    await createOrUpdateUserProfile({
        ...userCredential.user,
        displayName: name || userCredential.user.displayName
    });
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
