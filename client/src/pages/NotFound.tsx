import { Link } from "react-router-dom";
import { Button } from "@/components/Button";

export function NotFound() {
  return (
    <div className="mx-auto flex max-w-content flex-col items-center px-6 py-32 text-center">
      <p className="font-display text-6xl text-sage">404</p>
      <h1 className="mt-4 font-display text-3xl">We couldn't find that page.</h1>
      <Link to="/" className="mt-8">
        <Button>Back to home</Button>
      </Link>
    </div>
  );
}
