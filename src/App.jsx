import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { wakeServer } from "./services/api"; // [Cold start fix]
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import About from "./components/About";
import Portfolio from "./components/Portfolio";
import Booking from "./components/Booking";
import AdminDashboard from "./AdminDashboard"; // 👈 מייבאים את מסך הניהול החדש

function App() {
  // [Cold start fix] Clients usually browse the homepage first - wake the server meanwhile
  useEffect(() => {
    wakeServer();
  }, []);

  return (
    <div className="app">
      <Navbar />

      {/* אזור התוכן המשתנה */}
      <Routes>
        {/* עמוד הבית - מציג את כל סקשני השיווק */}
        <Route
          path="/"
          element={
            <>
              <Hero />
              <About />
              <Portfolio />
            </>
          }
        />

        {/* עמוד קביעת התור - מציג רק את הטופס */}
        <Route path="/booking" element={<Booking />} />

        {/* עמוד הניהול המוסתר (Admin) - כניסה ישירה דרך ה-URL בלבד 🔒 */}
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
    </div>
  );
}

export default App;
