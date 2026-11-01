import { startPayment } from '../_shared/handlers.ts';
import { deps } from '../_shared/deno.ts';

Deno.serve(req => startPayment(req, deps));
