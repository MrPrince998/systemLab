export interface Achievement {
  id: string
  icon: string
  title: string
  description: string
}

export const achievements: Achievement[] = [
  { id: 'orientation', icon: '🧭', title: 'Orientation', description: 'Finish the walkthrough.' },
  { id: 'first-run', icon: '🚀', title: 'Hello, world', description: 'Run a simulation where every request succeeds.' },
  { id: 'chaos', icon: '🐒', title: 'Chaos engineer', description: 'Kill 5 components on purpose.' },
  { id: 'cache', icon: '⚡', title: 'Cache whisperer', description: 'Reach an 80% cache hit rate with 20+ requests.' },
  { id: 'survivor', icon: '🛡️', title: 'Survivor', description: 'Serve every request while a component is down.' },
  { id: 'queue', icon: '📬', title: 'Back-pressure', description: 'Absorb a burst in a queue without failing a request.' },
  { id: 'breaker', icon: '🔌', title: 'Circuit breaker', description: 'Watch a circuit breaker fail fast.' },
  { id: 'stale', icon: '🕰️', title: 'Eventually consistent', description: 'Catch a stale read in the act.' },
  { id: 'prophet', icon: '🔮', title: 'Prophet', description: 'Predict 5 simulation outcomes correctly.' },
  { id: 'no-hints', icon: '🧠', title: 'No hints needed', description: 'Complete a mission without opening a hint.' },
  { id: 'frugal', icon: '💰', title: 'Frugal architect', description: 'Pass a mission that has a budget.' },
  { id: 'shared', icon: '🔗', title: 'Show and tell', description: 'Share a design link.' },
  { id: 'level-beginner', icon: '🌱', title: 'Beginner graduate', description: 'Complete every Beginner mission.' },
  { id: 'level-intermediate', icon: '⚡', title: 'Intermediate graduate', description: 'Complete every Intermediate mission.' },
  { id: 'level-advanced', icon: '🛡️', title: 'Advanced graduate', description: 'Complete every Advanced mission.' },
  { id: 'level-senior', icon: '🏛️', title: 'Senior architect', description: 'Complete every Senior mission.' },
]
