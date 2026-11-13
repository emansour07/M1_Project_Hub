class ResponseHeaders:
    def __init__(self,get_response):self.get_response=get_response
    def __call__(self,request):
        response=self.get_response(request)
        response['Referrer-Policy']='same-origin'
        response['X-Content-Type-Options']='nosniff'
        if request.path == '/' or request.path.startswith(('/api/','/owner/','/admin/','/editor','/sharing','/access-request','/runtime-config')):
            response['Cache-Control']='no-store'
        return response
