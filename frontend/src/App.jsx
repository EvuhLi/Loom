import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import ProfilePage from './profilepage';

function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: '10px', borderBottom: '1px solid #ccc' }}>
        <Link to="/profile">Profile</Link>
      </nav>
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;