import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const defaultDestinations = [
  { id: 'bali', name: 'Bali, Indonesia', tag: 'Island life', image: '/images/1.jpg' },
  { id: 'italy', name: 'The Italian coast', tag: 'Slow days', image: '/images/2.jpg' },
  { id: 'mountains', name: 'The mountains', tag: 'Wild & free', image: '/images/3.jpg' },
];

function App() {
  const [destinations, setDestinations] = useState(defaultDestinations);
  const [adminDestinations, setAdminDestinations] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [newDestination, setNewDestination] = useState({
    id: '',
    name: '',
    tag: '',
    image: '/images/1.jpg',
  });
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    destination: '',
    message: '',
  });
  const [status, setStatus] = useState({ type: '', message: '' });
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authMessage, setAuthMessage] = useState({ type: '', message: '' });
  const [token, setToken] = useState(() => localStorage.getItem('travel-explorer-token') || '');
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('travel-explorer-user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  const loadAdminData = async (jwt = token) => {
    if (!jwt) {
      setAdminDestinations([]);
      setEnquiries([]);
      return;
    }

    try {
      const [destinationResponse, enquiryResponse] = await Promise.all([
        fetch(`${API_BASE}/api/admin/destinations`, {
          headers: { Authorization: `Bearer ${jwt}` },
        }),
        fetch(`${API_BASE}/api/admin/enquiries`, {
          headers: { Authorization: `Bearer ${jwt}` },
        }),
      ]);

      if (destinationResponse.ok) {
        const destinationData = await destinationResponse.json();
        setAdminDestinations(Array.isArray(destinationData) ? destinationData : []);
      }

      if (enquiryResponse.ok) {
        const enquiryData = await enquiryResponse.json();
        setEnquiries(Array.isArray(enquiryData) ? enquiryData : []);
      }
    } catch (error) {
      console.error('Unable to load admin data', error);
    }
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/destinations`)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Unable to fetch destinations');
        }
        return response.json();
      })
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setDestinations(data);
          setAdminDestinations(data);
        }
      })
      .catch(() => {
        setDestinations(defaultDestinations);
      });

    if (token) {
      loadAdminData(token);
    }
  }, [token]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ type: 'info', message: 'Sending your enquiry...' });

    try {
      const response = await fetch(`${API_BASE}/api/enquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Unable to send enquiry.');
      }

      setStatus({ type: 'success', message: result.message });
      setForm({ name: '', email: '', phone: '', destination: '', message: '' });
      loadAdminData();
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Something went wrong.' });
    }
  };

  const handleDestinationCreate = async (event) => {
    event.preventDefault();

    try {
      const response = await fetch(`${API_BASE}/api/admin/destinations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newDestination),
      });

      if (!response.ok) {
        throw new Error('Unable to create destination.');
      }

      const createdDestination = await response.json();
      setAdminDestinations((current) => [...current, createdDestination]);
      setNewDestination({ id: '', name: '', tag: '', image: 'images/1.jpg' });
      setDestinations((current) => [...current, createdDestination]);
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Unable to create destination.' });
    }
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthMessage({ type: 'info', message: authMode === 'login' ? 'Signing in...' : 'Creating account...' });

    try {
      const response = await fetch(`${API_BASE}/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: authForm.name,
          email: authForm.email,
          password: authForm.password,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Authentication failed.');
      }

      localStorage.setItem('travel-explorer-token', result.token);
      localStorage.setItem('travel-explorer-user', JSON.stringify(result.user));
      setToken(result.token);
      setUser(result.user);
      setAuthForm({ name: '', email: '', password: '' });
      setAuthMessage({ type: 'success', message: authMode === 'login' ? 'Signed in successfully.' : 'Account created successfully.' });
      await loadAdminData(result.token);
    } catch (error) {
      setAuthMessage({ type: 'error', message: error.message || 'Something went wrong.' });
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('travel-explorer-token');
    localStorage.removeItem('travel-explorer-user');
    setToken('');
    setUser(null);
    setEnquiries([]);
    setAdminDestinations([]);
    setAuthMessage({ type: '', message: '' });
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">T</span>
          <span>travel<span className="brand-light">explorer</span></span>
        </div>
        <nav>
          <a href="#destinations">Destinations</a>
          <a href="#about">Story</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Your next chapter starts here</p>
            <h1>Find your <span>somewhere.</span></h1>
            <p className="subtitle">Thoughtful journeys, slower travel, and memories that stay with you.</p>
            <a className="cta" href="#destinations">Explore destinations</a>
          </div>
        </section>

        <section className="stats">
          <div><strong>25+</strong><span>Countries</span></div>
          <div><strong>1:1</strong><span>Travel planning</span></div>
          <div><strong>100%</strong><span>Personalised</span></div>
        </section>

        <section id="destinations" className="destinations">
          <div className="section-heading">
            <p className="eyebrow">A few places to begin</p>
            <h2>Beautiful escapes, built around you.</h2>
          </div>
          <div className="card-grid">
            {destinations.map((destination, index) => (
              <article className="destination-card" key={destination.id || index}>
                <img src={destination.image} alt={destination.name} />
                <div className="card-body">
                  <span className="card-index">{String(index + 1).padStart(2, '0')}</span>
                  <h3>{destination.name}</h3>
                  <p>{destination.tag}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="about" className="about">
          <div>
            <p className="eyebrow">Travel, with intention</p>
            <h2>More than a trip. A feeling that stays.</h2>
          </div>
          <p>
            We design experiences around the moments that matter: quiet breakfasts, beautiful roads,
            hidden corners, and places that make you slow down and truly feel alive.
          </p>
        </section>

        <section id="contact" className="contact">
          <div className="contact-copy">
            <p className="eyebrow">Let’s make it happen</p>
            <h2>Tell us your dream trip.</h2>
            <p>Share a few details and our team will help you shape the right itinerary.</p>
          </div>

          <form className="enquiry-form" onSubmit={handleSubmit}>
            <label>
              Name
              <input name="name" value={form.name} onChange={handleChange} required />
            </label>
            <label>
              Email
              <input name="email" type="email" value={form.email} onChange={handleChange} required />
            </label>
            <label>
              Phone
              <input name="phone" value={form.phone} onChange={handleChange} />
            </label>
            <label>
              Destination
              <input name="destination" value={form.destination} onChange={handleChange} />
            </label>
            <label>
              Message
              <textarea name="message" rows="4" value={form.message} onChange={handleChange} required />
            </label>
            <button type="submit">Send enquiry</button>
            {status.message && <p className={`status ${status.type}`}>{status.message}</p>}
          </form>
        </section>

        <section className="admin-panel">
          <div className="section-heading">
            <p className="eyebrow">Admin panel</p>
            <h2>Manage destinations and enquiries.</h2>
          </div>

          {!token ? (
            <div className="auth-card">
              <div className="auth-toggle">
                <button
                  type="button"
                  className={authMode === 'login' ? 'active' : ''}
                  onClick={() => setAuthMode('login')}
                >
                  Log in
                </button>
                <button
                  type="button"
                  className={authMode === 'register' ? 'active' : ''}
                  onClick={() => setAuthMode('register')}
                >
                  Register
                </button>
              </div>

              <form className="auth-form" onSubmit={handleAuthSubmit}>
                {authMode === 'register' && (
                  <label>
                    Name
                    <input
                      value={authForm.name}
                      onChange={(event) => setAuthForm((current) => ({ ...current, name: event.target.value }))}
                      required
                    />
                  </label>
                )}
                <label>
                  Email
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={authForm.password}
                    onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                    required
                  />
                </label>
                <button type="submit">{authMode === 'login' ? 'Log in' : 'Create account'}</button>
                {authMessage.message && <p className={`status ${authMessage.type}`}>{authMessage.message}</p>}
              </form>
            </div>
          ) : (
            <>
              <div className="admin-header">
                <p>Logged in as <strong>{user?.name || 'Admin'}</strong></p>
                <button type="button" className="secondary" onClick={handleLogout}>Log out</button>
              </div>

              <div className="admin-grid">
                <form className="admin-form" onSubmit={handleDestinationCreate}>
                  <h3>Add destination</h3>
                  <label>
                    ID
                    <input value={newDestination.id} onChange={(event) => setNewDestination((current) => ({ ...current, id: event.target.value }))} required />
                  </label>
                  <label>
                    Name
                    <input value={newDestination.name} onChange={(event) => setNewDestination((current) => ({ ...current, name: event.target.value }))} required />
                  </label>
                  <label>
                    Tag
                    <input value={newDestination.tag} onChange={(event) => setNewDestination((current) => ({ ...current, tag: event.target.value }))} required />
                  </label>
                  <label>
                    Image path
                    <input value={newDestination.image} onChange={(event) => setNewDestination((current) => ({ ...current, image: event.target.value }))} />
                  </label>
                  <button type="submit">Add destination</button>
                </form>

                <div className="admin-list">
                  <h3>Recent enquiries</h3>
                  {enquiries.length === 0 ? (
                    <p>No enquiries yet.</p>
                  ) : (
                    enquiries.slice(0, 5).map((item) => (
                      <div key={item.id || item.email} className="admin-item">
                        <strong>{item.name}</strong>
                        <span>{item.email}</span>
                        <small>{item.destination || 'Any destination'}</small>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
