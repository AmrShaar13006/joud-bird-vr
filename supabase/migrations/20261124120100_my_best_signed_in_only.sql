-- Supabase grants EXECUTE on new functions to anon by default; "my best" needs a signed-in user.
revoke execute on function public.get_my_best(text, text) from anon;
