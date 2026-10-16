'use client';

import { Component, type ReactNode } from 'react';

// One piece of the stream (the bug, the scenes, a stinger) that throws while
// drawing takes only itself down, and tries again a second later, instead of
// unmounting the whole page until someone refreshes the Browser Source.
export class Keep extends Component<{ children: ReactNode }, { down: boolean }> {
  state = { down: false };
  private t = 0;
  static getDerivedStateFromError() { return { down: true }; }
  componentDidCatch(e: unknown) {
    console.error('overlay piece failed', e);
    window.clearTimeout(this.t);
    this.t = window.setTimeout(() => this.setState({ down: false }), 1000);
  }
  componentWillUnmount() { window.clearTimeout(this.t); }
  render() { return this.state.down ? null : this.props.children; }
}
