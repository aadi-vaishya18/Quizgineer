const authContainer = document.querySelector(".auth-container");
const configContainer = document.querySelector(".config-container");
const quizContainer = document.querySelector(".quiz-container");
const resultContainer = document.querySelector(".result-container");
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

const handleSignup = async ({ name, email, password }) => {
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);

    if (name) {
        await userCredential.user.updateProfile({ displayName: name });
    }
};

const handleLogin = async ({ email, password }) => {
    await auth.signInWithEmailAndPassword(email, password);
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

    auth.onAuthStateChanged(user => {
        window.currentUser = user;

        if (user) {
            setAuthMessage("");
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
