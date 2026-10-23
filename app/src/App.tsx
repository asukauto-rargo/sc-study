import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/useAuth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Review from './pages/Review';
import Cards from './pages/Cards';
import PracticeA from './pages/PracticeA';
import PracticeB from './pages/PracticeB';

// 資料ビューアは pdf.js を含んで重いので、開いたときだけ読み込む
const Materials = lazy(() => import('./pages/Materials'));

function Loading() {
  return (
    <div className="center-screen">
      <div className="spinner" />
    </div>
  );
}

export default function App() {
  const { session, loading } = useAuth();

  if (loading) return <Loading />;
  if (!session) return <Login />;

  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/review" element={<Review />} />
          <Route path="/cards" element={<Cards />} />
          <Route path="/practice" element={<PracticeA />} />
          <Route path="/practice/b" element={<PracticeB />} />
          <Route path="/materials" element={<Materials />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
