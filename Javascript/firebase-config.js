const firebaseWebConfig = {
    apiKey: "AIzaSyDW6b63bNIv_w77THdix-Z-SGzFPvYZBU0",
    authDomain: "quizgineer.firebaseapp.com",
    projectId: "quizgineer",
    storageBucket: "quizgineer.firebasestorage.app",
    messagingSenderId: "1066627586092",
    appId: "1:1066627586092:web:f308fd008b103528585989",
    measurementId: "G-0XMJKR68RH"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseWebConfig);
}

window.firebaseServices = {
    auth: firebase.auth(),
    db: firebase.firestore(),
    analytics: typeof firebase.analytics === "function" ? firebase.analytics() : null
};

window.firebaseConfigReady = true;
console.info("Firebase connected successfully.");
