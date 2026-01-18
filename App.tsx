
import React, { useState, useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { ARViewer } from './components/ARViewer';
import { ARExperience } from './types';

const STORAGE_KEY = 'lumina_ar_projects_v2';

const App: React.FC = () => {
  const [view, setView] = useState<'dashboard' | 'viewer'>('dashboard');
  const [experiences, setExperiences] = useState<ARExperience[]>([]);
  const [activeExperience, setActiveExperience] = useState<ARExperience | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load experiences on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setExperiences(parsed);
        }
      } catch (e) {
        console.error("Failed to parse saved projects", e);
      }
    }
    setIsLoaded(true);
  }, []);

  // Persist experiences only after initial load to avoid overwriting with empty state
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(experiences));
    }
  }, [experiences, isLoaded]);

  // Handle URL Hash for deep linking and navigation
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#viewer/')) {
        const id = hash.replace('#viewer/', '');
        const found = experiences.find(e => e.id === id);
        if (found) {
          setActiveExperience(found);
          setView('viewer');
        } else {
          setView('dashboard');
          window.location.hash = '';
        }
      } else {
        setView('dashboard');
      }
    };

    if (isLoaded) {
      window.addEventListener('hashchange', handleHash);
      handleHash();
    }
    return () => window.removeEventListener('hashchange', handleHash);
  }, [experiences, isLoaded]);

  const saveExperience = (exp: ARExperience) => {
    setExperiences(prev => {
      const index = prev.findIndex(e => e.id === exp.id);
      if (index > -1) {
        const next = [...prev];
        next[index] = exp;
        return next;
      }
      return [exp, ...prev];
    });
  };

  const deleteExperience = (id: string) => {
    setExperiences(prev => prev.filter(e => e.id !== id));
  };

  const launchPreview = (exp: ARExperience) => {
    setActiveExperience(exp);
    window.location.hash = `#viewer/${exp.id}`;
  };

  const handleSpatialUpdate = (newTransform: ARExperience['transform']) => {
    if (activeExperience) {
      const updated = { ...activeExperience, transform: newTransform };
      setActiveExperience(updated);
      saveExperience(updated);
    }
  };

  if (!isLoaded) return <div className="bg-black h-screen w-screen flex items-center justify-center text-blue-500 font-mono text-xs uppercase tracking-widest">Initialising Spatial Engine...</div>;

  if (view === 'viewer' && activeExperience) {
    return (
      <div className="w-full h-screen relative">
        <ARViewer 
          experience={activeExperience} 
          onUpdate={handleSpatialUpdate}
          onTrackingStatusChange={(s) => console.log("Tracking status:", s)}
        />
        <button 
          onClick={() => { window.location.hash = ''; }}
          className="absolute top-6 left-6 z-50 bg-black/60 backdrop-blur-md text-white w-10 h-10 rounded-full flex items-center justify-center border border-white/20 active:scale-90 transition-transform hover:bg-black/80"
          title="Exit Viewer"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <Dashboard 
      experiences={experiences}
      onSave={saveExperience}
      onDelete={deleteExperience}
      onPreview={launchPreview} 
    />
  );
};

export default App;
