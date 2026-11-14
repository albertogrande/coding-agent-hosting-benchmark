class CommentsController < ApplicationController
  before_action :require_user

  def create
    task = Task.find(params[:task_id])
    task.comments.create!(author: current_user, body: params.expect(comment: [:body])[:body])
    redirect_to task_path(task)
  end
end
