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

// 🔧 FIX: Declare missing globals
let quizCategory = "";
let numberOfQuestions = 0;

let showQuizResult = () => {
    quizContainer.style.display = "none";
    resultContainer.style.display = "block";

    let resultText = `You answered <b>${correctAnswersCount}</b> out of <b>${numberOfQuestions}</b> questions correctly. Great effort!`;
    document.querySelector(".result-message").innerHTML = resultText;
};

let resetTimer = () => {
    clearInterval(timer);
    currentTime = QUIZ_TIME_LIMIT;
    timerDisplay.textContent = `${currentTime}s`;
};

let startTimer = () => {
    timer = setInterval(() => {
        currentTime--;
        timerDisplay.textContent = `${currentTime}s`;

       if (currentTime <= 0) {
        clearInterval(timer);
        highlightCorrectAnswer();
        nextQuestionBtn.style.visibility = "visible";
        quizContainer.querySelector(".quiz-timer").style.background = "#c31402";

        answerOptions.querySelectorAll(".answer-option")
            .forEach(option => option.style.pointerEvents = "none");
    }

    }, 1000);
};

let getRandomQuestions = () => {
    if (!quizCategory) return;

    let categoryObj = questions.find(
        cat => cat.category.toLowerCase() === quizCategory.toLowerCase()
    );

    if (!categoryObj) return;

    let categoryQuestions = categoryObj.questions;

    if (questionsIndexHistory.length >= Math.min(categoryQuestions.length, numberOfQuestions)) {
        showQuizResult();
        return;
    }

    let availableIndexes = categoryQuestions
        .map((_, index) => index)
        .filter(index => !questionsIndexHistory.includes(index));

    let randomIndex =
        availableIndexes[Math.floor(Math.random() * availableIndexes.length)];

    questionsIndexHistory.push(randomIndex);
    return categoryQuestions[randomIndex];
};

let highlightCorrectAnswer = () => {
    let correctOption =
        answerOptions.querySelectorAll(".answer-option")[currentQuestion.correctAnswer];

    if (!correctOption) return;

    correctOption.classList.add("correct");
    correctOption.insertAdjacentHTML(
        "beforeend",
        `<span class="material-symbols-rounded">check_circle</span>`
    );
};

let handleAnswer = (option, answerIndex) => {
    clearInterval(timer);

    let isCorrect = currentQuestion.correctAnswer === answerIndex;
    option.classList.add(isCorrect ? "correct" : "incorrect");

    if (!isCorrect) {
        highlightCorrectAnswer();
    } else {
        correctAnswersCount++;
    }

    option.insertAdjacentHTML(
        "beforeend",
        `<span class="material-symbols-rounded">${isCorrect ? "check_circle" : "cancel"}</span>`
    );

    answerOptions.querySelectorAll(".answer-option").forEach(
        opt => opt.style.pointerEvents = "none"
    );

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
    document.querySelector(".question-text").textContent =
        currentQuestion.question;

    questionStatus.innerHTML = `<b>${questionsIndexHistory.length}</b> of <b>${numberOfQuestions}</b> Questions`;

    currentQuestion.options.forEach((option, index) => {
        let li = document.createElement("li");
        li.classList.add("answer-option");
        li.textContent = option;
        answerOptions.appendChild(li);
        li.addEventListener("click", () => handleAnswer(li, index));
    });
};

let startQuiz = () => {
    quizCategory =
        configContainer.querySelector(".category-option.active")?.textContent;

    numberOfQuestions = parseInt(
        configContainer.querySelector(".question-option.active")?.textContent
    );

    if (!quizCategory || !numberOfQuestions) return;

    configContainer.style.display = "none";
    quizContainer.style.display = "block";

    correctAnswersCount = 0;
    questionsIndexHistory = [];

    renderQuestion();
};

document.querySelectorAll(".category-option, .question-option").forEach(option => {
    option.addEventListener("click", () => {
        option.parentNode.querySelector(".active").classList.remove("active");
        option.classList.add("active");
    });
});

let resetQuiz = () => {
    resetTimer();
    correctAnswersCount = 0;
    questionsIndexHistory = [];
    configContainer.style.display = "block";
    quizContainer.style.display = "none";
    resultContainer.style.display = "none";
};

nextQuestionBtn.addEventListener("click", renderQuestion);
document.querySelector(".restart-btn").addEventListener("click", resetQuiz);
document.querySelector(".start-btn").addEventListener("click", startQuiz);
