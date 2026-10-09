-- Existing rows are deliberately refreshed only inside this reverted test.
do $$declare r jsonb;good boolean;begin
 select rows->0 into r from app.m9_name_reviews order by woo_id limit 1;
 update app.m9_name_reviews set context_sha256=encode(extensions.digest(app.m9_name_context(r->>'product_name')::text,'sha256'),'hex'),reviewed_at=clock_timestamp() where woo_id=(r->>'woo_product_id')::bigint;
 if not app.m9_name_review_valid(r) then raise exception 'EXACT_ROW_REJECTED';end if;
 if app.m9_name_review_valid(jsonb_set(r,'{attributes}','{}')) then raise exception 'ATTRIBUTE_SUBSET_ACCEPTED';end if;
 if app.m9_name_review_valid(r-'description') then raise exception 'MISSING_FIELD_ACCEPTED';end if;
 if app.m9_name_review_valid(jsonb_set(r,'{price_cents}','1')) then raise exception 'CHANGED_PRICE_ACCEPTED';end if;
 if app.m9_name_review_valid(r||'{"extra":true}'::jsonb) then raise exception 'EXTRA_FIELD_ACCEPTED';end if;
end$$;
select jsonb_build_object('exact_row_accepted',true,'attribute_subset_rejected',true,'missing_field_rejected',true,'price_change_rejected',true,'extra_field_rejected',true) tests;
