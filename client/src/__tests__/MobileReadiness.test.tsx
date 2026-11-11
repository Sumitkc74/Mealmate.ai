import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navbar } from '@/components/layout/Navbar';
import { useAuthStore } from '@/stores/authStore';

function renderNavbar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Navbar />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Mobile Readiness and Navigation', () => {
  it('toggles mobile navigation drawer with hamburger button', async () => {
    useAuthStore.setState({
      token: 'fake-token',
      user: {
        id: 'u1',
        name: 'Test Chef',
        email: 'chef@example.com',
        role: 'user',
        pantry: [],
        dietaryPreferences: [],
        allergies: [],
      },
    });

    renderNavbar();
    const user = userEvent.setup();

    const hamburgerBtn = screen.getByRole('button', { name: /open navigation menu/i });
    expect(hamburgerBtn).toHaveAttribute('aria-expanded', 'false');

    // Open mobile menu
    await user.click(hamburgerBtn);
    expect(screen.getByRole('button', { name: /close navigation menu/i })).toHaveAttribute('aria-expanded', 'true');
    const mobileMenu = document.getElementById('mobile-nav-menu');
    expect(mobileMenu).toBeInTheDocument();

    // Close on Escape key
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('button', { name: /open navigation menu/i })).toHaveAttribute('aria-expanded', 'false');
  });
});

