import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import SignInForm from '../pages/SignInForm';
import SignUpForm from '../pages/SignUpForm';

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });

  container.remove();
});

function renderComponent(component) {
  act(() => {
    root.render(component);
  });
}

function enterValue(input, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;

    setter.call(input, value);

    input.dispatchEvent(
      new Event('input', { bubbles: true })
    );

    input.dispatchEvent(
      new Event('change', { bubbles: true })
    );
  });
}

describe('SignInForm', () => {
  test('renders email and password fields', () => {
    renderComponent(<SignInForm onSignIn={jest.fn()} />);

    expect(container.querySelector('input[name="email"]')).not.toBeNull();
    expect(container.querySelector('input[name="password"]')).not.toBeNull();

    expect(
      container.querySelector('button[type="submit"]').textContent
    ).toContain('Sign In');
  });

  test('submits entered email and password', () => {
    const onSignIn = jest.fn();

    renderComponent(<SignInForm onSignIn={onSignIn} />);

    enterValue(
      container.querySelector('input[name="email"]'),
      'customer@example.com'
    );

    enterValue(
      container.querySelector('input[name="password"]'),
      'test-password'
    );

    act(() => {
      container.querySelector('form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onSignIn).toHaveBeenCalledWith({
      email: 'customer@example.com',
      password: 'test-password',
    });
  });
});

describe('SignUpForm', () => {
  test('renders all six registration fields', () => {
    renderComponent(<SignUpForm onSignUp={jest.fn()} />);

    const expectedFields = [
      'firstName',
      'lastName',
      'address',
      'postalCode',
      'email',
      'password',
    ];

    expectedFields.forEach((name) => {
      expect(
        container.querySelector(`input[name="${name}"]`)
      ).not.toBeNull();
    });
  });

  test('submits all registration fields', () => {
    const onSignUp = jest.fn();

    renderComponent(<SignUpForm onSignUp={onSignUp} />);

    const fields = {
      firstName: 'Amith',
      lastName: 'Gowda',
      address: 'Bengaluru',
      postalCode: '560001',
      email: 'customer@example.com',
      password: 'test-password',
    };

    Object.entries(fields).forEach(([name, value]) => {
      enterValue(
        container.querySelector(`input[name="${name}"]`),
        value
      );
    });

    act(() => {
      container.querySelector('form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );
    });

    expect(onSignUp).toHaveBeenCalledTimes(1);
    expect(onSignUp).toHaveBeenCalledWith(fields);
  });
});
