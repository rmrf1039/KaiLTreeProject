import { Navigate, Route, Routes } from 'react-router-dom';
import { InputPage } from './pages/InputPage';
import { DisplayPage } from './pages/DisplayPage';

export function App() {
  return (
    <Routes>
      <Route path="/input" element={<InputPage />} />
      <Route path="/display" element={<DisplayPage />} />
      <Route path="*" element={<Navigate to="/input" replace />} />
    </Routes>
  );
}
