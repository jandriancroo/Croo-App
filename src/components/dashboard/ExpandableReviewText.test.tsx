import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExpandableReviewText,
  REVIEW_TRUNCATE_FALLBACK_CHARS,
  reviewTextIsTruncated,
} from './ExpandableReviewText';

afterEach(() => cleanup());

const LONG = 'A'.repeat(REVIEW_TRUNCATE_FALLBACK_CHARS + 40);
const SHORT = 'Great service.';
const GEORGETOWN_SAMPLE =
  'The acai bowl was fresh and the staff were kind, but the wait was longer than I expected on a Saturday morning and the parking lot was packed the whole time we were there.';

describe('reviewTextIsTruncated', () => {
  it('uses scrollHeight vs clientHeight when the element has a layout box', () => {
    expect(reviewTextIsTruncated({ scrollHeight: 80, clientHeight: 48 }, SHORT)).toBe(true);
    expect(reviewTextIsTruncated({ scrollHeight: 48, clientHeight: 48 }, LONG)).toBe(false);
  });

  it('falls back to character length when layout metrics are unavailable', () => {
    expect(reviewTextIsTruncated({ scrollHeight: 0, clientHeight: 0 }, LONG)).toBe(true);
    expect(reviewTextIsTruncated(null, SHORT)).toBe(false);
    expect(reviewTextIsTruncated(null, GEORGETOWN_SAMPLE)).toBe(GEORGETOWN_SAMPLE.length > REVIEW_TRUNCATE_FALLBACK_CHARS);
  });
});

describe('ExpandableReviewText', () => {
  it('renders review text as plain React text and does not parse HTML or markdown', () => {
    const raw = 'Loved it. <b>bold</b> and **wow** & <script>alert(1)</script>';
    const { container } = render(<ExpandableReviewText text={raw} reviewId="r1" />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<b>');
    expect(container.innerHTML).not.toContain('<script>');
    expect(container.innerHTML).not.toMatch(/dangerouslySetInnerHTML/);
    expect(screen.getByText(raw)).toBeTruthy();
  });

  it('hides the more label when the text fits', () => {
    render(<ExpandableReviewText text={SHORT} reviewId="short" />);
    expect(screen.queryByText('more')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows more when a long review is truncated, expands on click, and collapses again', () => {
    render(
      <ExpandableReviewText
        text={LONG}
        reviewId="long"
        className="review-body"
        clampClassName="line-clamp-3"
      />,
    );
    const more = screen.getByText('more');
    expect(more).toBeTruthy();
    expect(more.textContent).toBe('more');
    expect(screen.getByRole('button')).toBeTruthy();
    const paragraph = screen.getByText(LONG);
    expect(paragraph).toHaveClass('line-clamp-3');

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('less')).toBeTruthy();
    expect(screen.queryByText('more')).toBeNull();
    expect(paragraph).not.toHaveClass('line-clamp-3');

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('more')).toBeTruthy();
    expect(paragraph).toHaveClass('line-clamp-3');
  });

  it('resets to collapsed when the review changes', () => {
    const { rerender } = render(<ExpandableReviewText text={LONG} reviewId="r1" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('less')).toBeTruthy();
    rerender(<ExpandableReviewText text={`${LONG}B`} reviewId="r2" />);
    expect(screen.getByText('more')).toBeTruthy();
    expect(screen.queryByText('less')).toBeNull();
  });

  it('shows more for a long Georgetown-length Google review', () => {
    const text = `${GEORGETOWN_SAMPLE} I would still come back because the bowls are that good, but I wish I could read this whole note in the app.`;
    render(<ExpandableReviewText text={text} reviewId="georgetown" clampClassName="line-clamp-3" />);
    expect(text.length).toBeGreaterThan(REVIEW_TRUNCATE_FALLBACK_CHARS);
    expect(screen.getByText('more')).toBeTruthy();
  });
});
