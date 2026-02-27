from fastapi import APIRouter

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
async def login():
    # TODO: implement
    return {"message": "not implemented"}


@router.post("/refresh")
async def refresh():
    # TODO: implement
    return {"message": "not implemented"}


@router.post("/logout")
async def logout():
    # TODO: implement
    return {"message": "not implemented"}
