import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Labeling from "./pages/Labeling";
import ProtectedRoute from "./components/ProtectedRoute";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <Labeling />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/app" replace />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
    
  );
}